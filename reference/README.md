# Reference Repos

Read-only shallow clones of repos useful as context for the AI Coworker — project knowledge, dependency sources, usage examples, etc.

## Usage

```bash
pnpm reference     # clone missing repos, update stale ones
```

## Adding a repo

Append a line to the `repos` array in `clone.sh`:

```bash
"name  https://github.com/org/repo.git"
```

Extra git-clone flags can follow the URL (e.g. `--branch v2`).

All clones are `--depth 1` (shallow) and made read-only (`chmod -R a-w`). On each run, the script checks if the local HEAD matches the remote — stale repos are automatically re-cloned.
