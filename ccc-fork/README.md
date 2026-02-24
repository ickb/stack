# CCC Local Development

## Why

CCC has unreleased branches (`releases/next`, `releases/udt`) that this project depends on. The fork management system deterministically merges them locally so the monorepo can build against unpublished CCC changes until they're published upstream.

## How it works

1. **Auto-replay** — `.pnpmfile.cjs` runs at `pnpm install` time. If `ccc-fork/pins/manifest` exists but `ccc-fork/ccc/` doesn't, it auto-triggers `fork-scripts/replay.sh` to clone and set up CCC.

2. **Workspace override** — When `ccc-fork/ccc/` is present, `.pnpmfile.cjs` auto-discovers all CCC packages (via `config.json` workspace settings) and rewrites `@ckb-ccc/*` dependencies to `workspace:*` — no manual `pnpm.overrides` needed. This is necessary because `catalog:` specifiers resolve to a semver range _before_ pnpm considers workspace linking — even with `link-workspace-packages = true`, pnpm fetches from the registry without this hook. When CCC is not cloned, the hook is a no-op and deps resolve from the registry normally.

3. **Source-level types** — `fork-scripts/patch.sh` (called by both `record.sh` and `replay.sh`) patches CCC's `package.json` exports to point TypeScript at `.ts` source instead of built `.d.ts`, then creates a deterministic git commit (fixed author/date). This gives real-time type feedback when editing across the CCC/stack boundary — changes in CCC source are immediately visible to stack packages without rebuilding.

4. **Diagnostic filtering** — `fork-scripts/tsgo-filter.sh` is a bash wrapper around `tsgo` used by stack package builds. Because CCC `.ts` source is type-checked under the stack's stricter tsconfig (`verbatimModuleSyntax`, `noImplicitOverride`, `noUncheckedIndexedAccess`), plain `tsgo` would report hundreds of CCC diagnostics that aren't real integration errors. The wrapper emits output normally and only fails on diagnostics from stack source files. When no forks are cloned, packages fall back to plain `tsgo`.

## Configuration

CCC-specific settings live in `ccc-fork/config.json`:

```json
{
  "upstream": "https://github.com/ckb-devrel/ccc.git",
  "fork": "git@github.com:phroi/ccc.git",
  "refs": ["359", "328", "releases/next", "releases/udt"],
  "cloneDir": "ccc",
  "workspace": {
    "include": ["packages/*"],
    "exclude": ["packages/demo", "packages/docs", ...]
  }
}
```

- **upstream**: Git URL to clone from
- **fork**: SSH URL of developer fork, added as `fork` remote after replay
- **refs**: Merge refs — PR numbers, branch names, or commit SHAs (auto-detected)
- **cloneDir**: Name of the cloned directory inside `ccc-fork/`
- **workspace**: Glob patterns for pnpm workspace inclusion/exclusion

## `pins/` format

```
ccc-fork/pins/
  HEAD              # expected SHA after full replay (merges + patch.sh + local patches)
  manifest          # base SHA + merge refs, TSV, one per line
  res-2.resolution  # conflict resolution for merge step 2 (if any)
  res-4.resolution  # conflict resolution for merge step 4 (gaps = no conflicts)
  local-001.patch   # local development patch (applied after merges + patch.sh)
  local-002.patch   # local development patch
```

- **`HEAD`**: one line, the expected final SHA after everything (merges, `patch.sh`, local patches). Verification happens at the end of replay.
- **`manifest`**: TSV, one line per ref. Line 1 is the base commit (`SHA\tbranchname`); subsequent lines are merge refs applied sequentially onto `wip`.
- **`res-N.resolution`**: counted conflict resolution for merge step N. Only present for merge steps that had conflicts. Uses positional parsing (line counts, not content inspection) for deterministic replay.
- **`local-*.patch`**: standard unified diffs of local work, applied in lexicographic order after merges + `patch.sh`, each as a deterministic commit.

All files are human-readable and editable.

## Recording

Recording captures the current upstream state and any conflict resolutions:

```bash
pnpm fork:record ccc-fork
```

This runs `fork-scripts/record.sh` which reads refs from `config.json`, clones CCC, merges the configured refs, uses AI Coworker to resolve any conflicts, patches for source-level type resolution, and writes `pins/`. Commit the resulting `ccc-fork/pins/` directory so other contributors get the same build.

You can override refs on the command line:

```bash
pnpm fork:record ccc-fork 359 328 releases/next releases/udt
```

### Ref auto-detection

`record.sh` accepts any number of refs and auto-detects their type:
- `^[0-9a-f]{7,40}$` → commit SHA
- `^[0-9]+$` → GitHub PR number
- everything else → branch name

### Conflict resolution format

When merges produce conflicts, `record.sh` resolves them and stores the resolution as a counted resolution file in `pins/res-N.resolution` (where N is the 1-indexed merge step). These use a positional format with `CONFLICT ours=N base=M theirs=K resolution=R` headers, so you can:

- **Inspect** exactly what was resolved and how
- **Edit by hand** if the AI resolution needs adjustment
- **Diff across re-records** to see what changed

## Developing CCC changes

Work directly in `ccc-fork/ccc/` on the `wip` branch. `pnpm fork:status ccc-fork` tracks pending changes (exit 0 = clean, exit 1 = has work).

### Development loop

1. **Edit code** on `wip` in `ccc-fork/ccc/`. Commit normally.
2. **Rebuild**: `pnpm build` (builds stack packages with CCC type integration).
3. **Run tests**: `pnpm test`

### Saving local patches

When you have local changes that should persist across re-records:

```bash
pnpm fork:save ccc-fork [description]
```

This captures all changes (committed + uncommitted) relative to the pinned HEAD as a patch file in `pins/`. The patch is applied deterministically during replay, so it survives `pnpm fork:clean ccc-fork && pnpm install` cycles.

Example workflow:
1. Edit files in `ccc-fork/ccc/`
2. `pnpm fork:save ccc-fork my-feature` → creates `pins/local-001-my-feature.patch`
3. Edit more files
4. `pnpm fork:save ccc-fork another-fix` → creates `pins/local-002-another-fix.patch`
5. `pnpm fork:clean ccc-fork && pnpm install` → replays merges + patches, HEAD matches

Local patches are preserved across `pnpm fork:record ccc-fork` — they're backed up before re-recording and restored afterwards.

### Committing CCC changes to stack

When ready to commit stack changes that depend on CCC modifications:

1. Open a draft PR for the CCC changes (push to fork, PR against `ckb-devrel/ccc`)
2. Add the PR number to `refs` in `ccc-fork/config.json`
3. Run `pnpm fork:record ccc-fork` — this re-records with the PR as a merge ref
4. Commit the updated `ccc-fork/pins/` to the stack repo

### Pushing to a PR branch

Extract your commits (those after the recording) onto the PR branch:

```bash
pnpm fork:push ccc-fork
cd ccc-fork/ccc
git push fork pr-666:your-branch-name
git checkout wip  # return to development
```

## Switching modes

**Check for pending work:** `pnpm fork:status ccc-fork` — exit 0 if clone matches pinned state (safe to wipe), exit 1 otherwise.

**Local CCC (default when `pins/` is committed):** `pnpm install` auto-replays pins and overrides deps.

**Published CCC:** `pnpm fork:reset ccc-fork && pnpm install` — removes clone and pins, restores published packages.

**Re-record:** `pnpm fork:record ccc-fork` wipes and re-records everything from scratch. Aborts if clone has pending work. Local patches are preserved.

**Force re-replay:** `pnpm fork:clean ccc-fork && pnpm install` — removes clone but keeps pins, replays on next install.

## Requirements

- **Recording** (`pnpm fork:record`): Requires the AI Coworker CLI (installed as a devDependency; invoked via `pnpm coworker:ask`) for automated conflict resolution (only when merging refs). Also requires `jq` for config.json and package.json processing.
- **Replay** (`pnpm install`): Requires `jq`. No other extra tools — works for any contributor with just pnpm.
