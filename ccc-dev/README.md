# CCC Local Development

## Why

CCC has unreleased branches (`releases/next`, `releases/udt`) that this project depends on. This system deterministically merges them locally so the monorepo can build against unpublished CCC changes until they're published upstream.

## How it works

1. `.pnpmfile.cjs` runs at pnpm install time. If `ccc-dev/pins/REFS` exists but `ccc-dev/ccc/` doesn't, it auto-triggers `replay.sh`.
2. `replay.sh` clones CCC, checks out the pinned base SHA, and replays each merge using pinned SHAs and saved conflict resolutions — producing a deterministic build.
3. `.pnpmfile.cjs` then overrides all `@ckb-ccc/*` dependencies to `workspace:*`, pointing them at the local `ccc-dev/ccc/packages/` builds.

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

This runs `ccc-dev/record.sh` which clones CCC, merges the configured refs (`releases/next`, `releases/udt`), uses Claude CLI to resolve any conflicts, builds, and writes `pins/`. Commit the resulting `ccc-dev/pins/` directory so other contributors get the same build.

## Developing CCC PRs

### Setup

Record upstream refs alongside a PR:

```bash
pnpm ccc:record 666
```

This merges `releases/next`, `releases/udt`, and PR #666 onto the `wip` branch and builds.
You stay on `wip` — all upstream + PR changes are available. VS Code sees the full merged state.

### Development loop

1. **Edit code** on `wip` in `ccc-dev/ccc/`. Commit normally.
2. **Rebuild**: `pnpm build` (now includes CCC packages).
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

**Local CCC (default when `pins/` is committed):** `pnpm install` auto-replays pins and overrides deps.

**Published CCC:** `pnpm ccc:reset && pnpm install` — removes clone and pins, restores published packages.

**Re-record:** `pnpm ccc:record` wipes and re-records everything from scratch.

**Force re-replay:** `pnpm ccc:clean && pnpm install` — removes clone but keeps pins, replays on next install.

## Requirements

- **Recording** (`pnpm ccc:record`): Requires [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) for automated conflict resolution (only when merging refs).
- **Replay** (`pnpm install`): No extra tools needed — works for any contributor with just pnpm.
