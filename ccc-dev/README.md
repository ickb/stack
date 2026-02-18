# CCC Local Development

## Why

CCC has unreleased branches (`releases/next`, `releases/udt`) that this project depends on. This system deterministically merges them locally so the monorepo can build against unpublished CCC changes until they're published upstream.

## How it works

1. **Auto-replay** — `.pnpmfile.cjs` runs at `pnpm install` time. If `ccc-dev/pins/REFS` exists but `ccc-dev/ccc/` doesn't, it auto-triggers `replay.sh` to clone and set up CCC.

2. **Workspace override** — When `ccc-dev/ccc/` is present, `.pnpmfile.cjs` auto-discovers all CCC packages and rewrites `@ckb-ccc/*` dependencies to `workspace:*` — no manual `pnpm.overrides` needed. This is necessary because `catalog:` specifiers resolve to a semver range _before_ pnpm considers workspace linking — even with `link-workspace-packages = true`, pnpm fetches from the registry without this hook. When CCC is not cloned, the hook is a no-op and deps resolve from the registry normally.

3. **Source-level types** — `patch.sh` (called by both `record.sh` and `replay.sh`) patches CCC's `package.json` exports to point TypeScript at `.ts` source instead of built `.d.ts`, then creates a deterministic git commit (fixed author/date) so record and replay produce the same `pins/HEAD` hash. This gives real-time type feedback when editing across the CCC/stack boundary — changes in CCC source are immediately visible to stack packages without rebuilding.

4. **Diagnostic filtering** — `ccc-dev/tsc.mjs` is a tsc wrapper used by stack package builds. Because CCC `.ts` source is type-checked under the stack's stricter tsconfig (`verbatimModuleSyntax`, `noImplicitOverride`, `noUncheckedIndexedAccess`), plain `tsc` would report hundreds of CCC diagnostics that aren't real integration errors. The wrapper emits output normally and only fails on diagnostics from stack source files. When CCC is not cloned, packages fall back to plain `tsc`.

## `pins/` format

```
ccc-dev/pins/
  REFS              # Line 1: base SHA. Lines 2+: "SHA refname" (one per merge)
  HEAD              # Expected final SHA after all merges (integrity check)
  resolutions/      # Saved conflict resolution files, organized by merge index
    1/path/to/file  # Resolved file for merge step 1
    2/path/to/file  # Resolved file for merge step 2
```

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
    "ccc:record": "bash ccc-dev/record.sh releases/next releases/udt"
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

## Developing CCC PRs

### Setup

Record upstream refs alongside a PR:

```bash
pnpm ccc:record 666
```

This merges `releases/next`, `releases/udt`, and PR #666 onto the `wip` branch.
You stay on `wip` — all upstream + PR changes are available. VS Code sees the full merged state with diagnostics using CCC's own tsconfig rules.

### Development loop

1. **Edit code** on `wip` in `ccc-dev/ccc/`. Commit normally.
2. **Rebuild**: `pnpm build` (builds stack packages with CCC type integration).
3. **Run tests**: `pnpm test`

### Pushing your changes

Extract your commits (those after the recording) onto the PR branch:

```bash
pnpm ccc:push
cd ccc-dev/ccc
git remote add fork https://github.com/YOUR_USER/ccc.git
git push fork pr-666:your-branch-name
git checkout wip  # return to development
```

## Switching modes

**Check for pending work:** `pnpm ccc:status` — exit 0 if `ccc-dev/ccc/` matches pinned state (safe to wipe), exit 1 otherwise.

**Local CCC (default when `pins/` is committed):** `pnpm install` auto-replays pins and overrides deps.

**Published CCC:** `pnpm ccc:reset && pnpm install` — removes clone and pins, restores published packages.

**Re-record:** `pnpm ccc:record` wipes and re-records everything from scratch. Aborts if `ccc-dev/ccc/` has pending work.

**Force re-replay:** `pnpm ccc:clean && pnpm install` — removes clone but keeps pins, replays on next install.

## Requirements

- **Recording** (`pnpm ccc:record`): Requires the AI Coworker CLI (installed as a devDependency; invoked via `pnpm coworker:ask`) for automated conflict resolution (only when merging refs).
- **Replay** (`pnpm install`): No extra tools needed — works for any contributor with just pnpm.
