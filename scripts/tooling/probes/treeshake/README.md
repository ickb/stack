# Treeshake probe

Committed reproducer for amendment 12 of the
[Stack rewrite decisions](../../../../docs/stack-rewrite/decisions.md):

1. **Source scan** — fails if any `@__PURE__` annotation appears inside a
   `static {}` block under `packages/*/src` (rollup deletes the annotated call
   while keeping the class: silently runtime-broken entities).
2. **Hazard reproducer** — demonstrates that breakage on a toy entity with
   the repo-pinned rollup, so the ban stays backed by executable evidence.
3. **Budget positive** — a clean-layout module graph (entity module hosts
   only the entity) must let a one-symbol consumer prune the entity within
   2 KiB under the repo-pinned esbuild. At Phase 3a the same budget is
   asserted against the packed merged `@ickb/sdk` tarball and becomes the
   mandatory exit gate.

Run via `pnpm probes` (or `node scripts/tooling/probes/treeshake/run.ts`).
Scratch output lives under `scratch/` (gitignored) and is always removed.
