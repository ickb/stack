# CCC Local Development

## Why

CCC has unreleased branches (`releases/next`, `releases/udt`) that this project depends on. This system deterministically merges them locally so the monorepo can build against unpublished CCC changes until they're published upstream.

## How it works

1. **Auto-replay** — `.pnpmfile.cjs` runs at `pnpm install` time. If `ccc-dev/pins/manifest` exists but `ccc-dev/ccc/` doesn't, it auto-triggers `replay.sh` to clone and set up CCC.

2. **Workspace override** — When `ccc-dev/ccc/` is present, `.pnpmfile.cjs` auto-discovers all CCC packages and rewrites `@ckb-ccc/*` dependencies to `workspace:*` — no manual `pnpm.overrides` needed. This is necessary because `catalog:` specifiers resolve to a semver range _before_ pnpm considers workspace linking — even with `link-workspace-packages = true`, pnpm fetches from the registry without this hook. When CCC is not cloned, the hook is a no-op and deps resolve from the registry normally.

3. **Source-level types** — `patch.sh` (called by both `record.sh` and `replay.sh`) patches CCC's `package.json` exports to point TypeScript at `.ts` source instead of built `.d.ts`, then creates a deterministic git commit (fixed author/date). This gives real-time type feedback when editing across the CCC/stack boundary — changes in CCC source are immediately visible to stack packages without rebuilding.

4. **Diagnostic filtering** — `ccc-dev/tsgo-filter.sh` is a bash wrapper around `tsgo` used by stack package builds. Because CCC `.ts` source is type-checked under the stack's stricter tsconfig (`verbatimModuleSyntax`, `noImplicitOverride`, `noUncheckedIndexedAccess`), plain `tsgo` would report hundreds of CCC diagnostics that aren't real integration errors. The wrapper emits output normally and only fails on diagnostics from stack source files. When CCC is not cloned, packages fall back to plain `tsgo`.

## `pins/` format

```
ccc-dev/pins/
  HEAD              # expected SHA after full replay (merges + patch.sh + local patches)
  manifest          # base SHA + merge refs, TSV, one per line
  res-1.diff        # conflict resolution for merge step 1 (if any)
  res-3.diff        # conflict resolution for merge step 3 (gaps = no conflicts)
  local-001.patch   # local development patch (applied after merges + patch.sh)
  local-002.patch   # local development patch
```

- **`HEAD`**: one line, the expected final SHA after everything (merges, `patch.sh`, local patches). Verification happens at the end of replay.
- **`manifest`**: TSV, one line per ref. Line 1 is the base commit (`SHA\tbranchname`); subsequent lines are merge refs applied sequentially onto `wip`.
- **`res-N.diff`**: standard unified diff for conflict resolution at merge step N. Only present for merge steps that had conflicts. Applied with `patch -p1` during replay.
- **`local-*.patch`**: standard unified diffs of local work, applied in lexicographic order after merges + `patch.sh`, each as a deterministic commit.

All files are human-readable and editable. Resolution diffs and local patches use standard unified diff format.

## Recording

Recording captures the current upstream state and any conflict resolutions:

```bash
pnpm ccc:record
```

This runs `ccc-dev/record.sh` which clones CCC, merges the configured refs, uses AI Coworker to resolve any conflicts, patches for source-level type resolution, and writes `pins/`. Commit the resulting `ccc-dev/pins/` directory so other contributors get the same build.

The `ccc:record` script in `package.json` is preconfigured with the current refs:

```json
{
  "scripts": {
    "ccc:record": "bash ccc-dev/record.sh 359 328 releases/next releases/udt"
  }
}
```

### Ref auto-detection

`record.sh` accepts any number of refs and auto-detects their type:

```bash
# Usage: ccc-dev/record.sh <ref ...>
#   - ^[0-9a-f]{7,40}$ → commit SHA
#   - ^[0-9]+$          → GitHub PR number
#   - everything else   → branch name

# Examples:
bash ccc-dev/record.sh releases/next releases/udt
bash ccc-dev/record.sh 268 releases/next
bash ccc-dev/record.sh abc1234
```

Refs are merged sequentially onto a `wip` branch, then CCC is built. On merge conflicts, the script auto-resolves them using AI Coworker.

### Conflict resolution diffs

When merges produce conflicts, `record.sh` resolves them and stores the resolution as a unified diff in `pins/res-N.diff` (where N is the 1-indexed merge step). These diffs transform the conflicted file (with markers) into the resolved file, so you can:

- **Inspect** exactly what was resolved and how
- **Edit by hand** if the AI resolution needs adjustment
- **Diff across re-records** to see what changed

## Developing CCC changes

Work directly in `ccc-dev/ccc/` on the `wip` branch. `pnpm ccc:status` tracks pending changes (exit 0 = clean, exit 1 = has work).

### Development loop

1. **Edit code** on `wip` in `ccc-dev/ccc/`. Commit normally.
2. **Rebuild**: `pnpm build` (builds stack packages with CCC type integration).
3. **Run tests**: `pnpm test`

### Saving local patches

When you have local changes that should persist across re-records:

```bash
pnpm ccc:save [description]
```

This captures all changes (committed + uncommitted) relative to the pinned HEAD as a patch file in `pins/`. The patch is applied deterministically during replay, so it survives `pnpm ccc:clean && pnpm install` cycles.

Example workflow:
1. Edit files in `ccc-dev/ccc/`
2. `pnpm ccc:save my-feature` → creates `pins/local-001-my-feature.patch`
3. Edit more files
4. `pnpm ccc:save another-fix` → creates `pins/local-002-another-fix.patch`
5. `pnpm ccc:clean && pnpm install` → replays merges + patches, HEAD matches

Local patches are preserved across `pnpm ccc:record` — they're backed up before re-recording and restored afterwards.

### Committing CCC changes to stack

When ready to commit stack changes that depend on CCC modifications:

1. Open a draft PR for the CCC changes (push to fork, PR against `ckb-devrel/ccc`)
2. Add the PR number to `ccc:record` in `package.json`
3. Run `pnpm ccc:record` — this re-records with the PR as a merge ref
4. Commit the updated `ccc-dev/pins/` to the stack repo

### Pushing to a PR branch

Extract your commits (those after the recording) onto the PR branch:

```bash
pnpm ccc:push
cd ccc-dev/ccc
git push fork pr-666:your-branch-name
git checkout wip  # return to development
```

## Switching modes

**Check for pending work:** `pnpm ccc:status` — exit 0 if `ccc-dev/ccc/` matches pinned state (safe to wipe), exit 1 otherwise.

**Local CCC (default when `pins/` is committed):** `pnpm install` auto-replays pins and overrides deps.

**Published CCC:** `pnpm ccc:reset && pnpm install` — removes clone and pins, restores published packages.

**Re-record:** `pnpm ccc:record` wipes and re-records everything from scratch. Aborts if `ccc-dev/ccc/` has pending work. Local patches are preserved.

**Force re-replay:** `pnpm ccc:clean && pnpm install` — removes clone but keeps pins, replays on next install.

## Requirements

- **Recording** (`pnpm ccc:record`): Requires the AI Coworker CLI (installed as a devDependency; invoked via `pnpm coworker:ask`) for automated conflict resolution (only when merging refs).
- **Replay** (`pnpm install`): No extra tools needed — works for any contributor with just pnpm.
