# CCC Local Development

This directory manages local development against unpublished [CCC](https://github.com/ckb-devrel/ccc) changes.

## Structure

```
ccc/
  setup.sh        # Setup script (record/replay/merge modes)
  patches/        # Committed — pinned SHAs and conflict resolutions
    REFS           # Base SHA + merge SHAs
    resolutions/   # Saved conflict resolution files
  .cache/          # Gitignored — ephemeral CCC clone (auto-generated)
    packages/...
```

## Automatic Setup

When `ccc/patches/REFS` is committed, running `pnpm install` at the repo root automatically replays CCC patches on first run — no manual setup needed. This is handled by `.pnpmfile.cjs` at module load time, before pnpm resolves dependencies.

To redo setup from scratch:

```bash
rm -rf ccc/.cache && pnpm install
```

## Recording New Patches

```bash
# Merge + record SHAs and conflict resolutions
rm -rf ccc/.cache
bash ccc/setup.sh --record releases/next releases/udt

# Replay from pinned SHAs (also runs automatically via pnpm install)
bash ccc/setup.sh --replay
```
