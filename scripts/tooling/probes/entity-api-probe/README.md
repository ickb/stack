# entity-api-probe

Committed, re-runnable check for the Phase-1 exit item recorded in
`docs/stack-rewrite/decisions.md` amendment 8 (review
finding F-006): the previously-ephemeral `/tmp/entity-ae-check` verdict is now
reproducible on demand.

## What it proves

The B4 entity recipe survives the repo's real toolchain end to end:

1. TypeScript declaration emit with the repo emit shape (`tsgo -p
tsconfig.build.json` extending the root `tsconfig.json`, then the
   `rewrite-dts-imports` step, mirroring `packages/core`) produces a `.d.ts`
   with no unnameable anonymous base type. The template is two modules
   (`entity_base.ts` shared helper + `index.ts` entity barrel), matching the
   amendment §7 target shape.
2. `api-extractor run` against that `.d.ts`, extending the repo's
   `api-extractor.base.json` exactly as published packages do
   (`ae-forgotten-export` and `ae-missing-release-tag` as errors, `apiReport`
   disabled), reports no errors.
3. **Negative control:** a second pass with the `ProbeDataBase` export removed
   must fail with `ae-forgotten-export`. If it does not, the gate has silently
   demoted (for example a future `api-extractor.base.json` edit downgrading the
   message severity) and the probe fails.

The probe exits nonzero on any build or extractor error, and on a passing
negative control.

## The B4 recipe it guards

```ts
export type EntityBase<Like, Type> = ReturnType<typeof ccc.Entity.Base<Like, Type>>;
export const XBase: EntityBase<XLike, X> = ccc.Entity.Base<XLike, X>();
export class X extends XBase { ... }
```

with `@public` on `XLike`, `XBase`, and `X`. The shared `EntityBase` helper
lives in `shared/` after the Phase-3 merge; the per-entity `XBase` consts are
part of the root export contract (decision-record amendment 7).

**Config caveat (amendment §8):** when committed api reports are enabled at
Phase-3a, set `"ae-forgotten-export": {"logLevel": "error",
"addToApiReportFile": false}` — otherwise api-extractor appends the forgotten
export to the report instead of failing, and the gate silently demotes.

## How it runs

```sh
node scripts/tooling/probes/entity-api-probe/run.ts
```

The runner assembles a scratch project under `scratch/` (gitignored here):
copies `template/index.ts.txt` to `scratch/src/index.ts`, links the
workspace-installed `@ckb-ccc/core` (via `packages/core/node_modules`), writes
the mirrored `tsconfig.build.json` and an `api-extractor.json` extending the
repo base, then runs `tsgo` and `api-extractor`. Scratch is always removed
afterwards (leftover `.ts` files would leak into the root tsconfig, eslint, and
knip globs); failure diagnostics are printed to stderr instead.

The probe source is committed as `template/index.ts.txt` (not `.ts`) because
`@ckb-ccc/core` is not resolvable from the repository root, so a bare-import
`.ts` file under `scripts/` would break the root `lint:typecheck`; the probe's
own `tsgo` run typechecks it instead.
