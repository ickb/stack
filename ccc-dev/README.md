# CCC Local Development

## Why

CCC has unreleased branches (`releases/next`, `releases/udt`) that this project depends on. This system deterministically merges them locally so the monorepo can build against unpublished CCC changes until they're published upstream.

## How it works

1. **Auto-replay** — `.pnpmfile.cjs` runs at `pnpm install` time. If `ccc-dev/pins/` contains a SHA-named file but `ccc-dev/ccc/` doesn't, it auto-triggers `replay.sh` to clone and set up CCC.

2. **Workspace override** — When `ccc-dev/ccc/` is present, `.pnpmfile.cjs` auto-discovers all CCC packages and rewrites `@ckb-ccc/*` dependencies to `workspace:*` — no manual `pnpm.overrides` needed. This is necessary because `catalog:` specifiers resolve to a semver range _before_ pnpm considers workspace linking — even with `link-workspace-packages = true`, pnpm fetches from the registry without this hook. When CCC is not cloned, the hook is a no-op and deps resolve from the registry normally.

3. **Source-level types** — `patch.sh` (called by both `record.sh` and `replay.sh`) patches CCC's `package.json` exports to point TypeScript at `.ts` source instead of built `.d.ts`, then creates a deterministic git commit (fixed author/date) so record and replay produce the same HEAD hash (used as the pins filename). This gives real-time type feedback when editing across the CCC/stack boundary — changes in CCC source are immediately visible to stack packages without rebuilding.

4. **Diagnostic filtering** — `ccc-dev/tsgo-filter.sh` is a bash wrapper around `tsgo` used by stack package builds. Because CCC `.ts` source is type-checked under the stack's stricter tsconfig (`verbatimModuleSyntax`, `noImplicitOverride`, `noUncheckedIndexedAccess`), plain `tsgo` would report hundreds of CCC diagnostics that aren't real integration errors. The wrapper emits output normally and only fails on diagnostics from stack source files. When CCC is not cloned, packages fall back to plain `tsgo`.

## `pins/` format

A single file named by the HEAD SHA (the verification hash). The filename itself proves integrity — if replay produces a different HEAD, the pins are stale.

```
ccc-dev/pins/
  <HEAD_SHA>        # Single file — filename is the expected HEAD after replay
```

File contents:

```
50d657beea36de3ebbd80ee88209842644daef34 master
8e63e3a21f1824445b2c339ffe4927a2a8af1bcf 359
5761fe63fcb29ac810fab5e71063424692f65592 328
0e18748fb139d71338c109d71aae5b149cb58af3 releases/next
0ad2a5f6305d4964b00394bc8a6ed50136fdffa8 releases/udt
=== 2 packages/core/src/ckb/transaction.ts 1 ===
import { ... } from "./transactionErrors.js";
```

- **Line 1**: `BASE_SHA default-branch` — the upstream commit to clone and checkout
- **Lines 2+**: `SHA refname` — merge refs applied sequentially onto `wip`
- **`=== N path hunk ===`**: conflict resolution hunks (only present when merges conflict)

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

## Developing CCC changes

Work directly in `ccc-dev/ccc/` on the `wip` branch. `pnpm ccc:status` tracks pending changes (exit 0 = clean, exit 1 = has work).

### Development loop

1. **Edit code** on `wip` in `ccc-dev/ccc/`. Commit normally.
2. **Rebuild**: `pnpm build` (builds stack packages with CCC type integration).
3. **Run tests**: `pnpm test`

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

**Re-record:** `pnpm ccc:record` wipes and re-records everything from scratch. Aborts if `ccc-dev/ccc/` has pending work.

**Force re-replay:** `pnpm ccc:clean && pnpm install` — removes clone but keeps pins, replays on next install.

## Requirements

- **Recording** (`pnpm ccc:record`): Requires the AI Coworker CLI (installed as a devDependency; invoked via `pnpm coworker:ask`) for automated conflict resolution (only when merging refs).
- **Replay** (`pnpm install`): No extra tools needed — works for any contributor with just pnpm.
