# iCKB Stack

iCKB Stack is the monorepo for the current TypeScript iCKB libraries and apps built on top of [CCC](https://github.com/ckb-devrel/ccc).

## Transaction Completion Boundary

`@ickb/sdk` stops at protocol-specific transaction construction. It returns partial `ccc.Transaction` values and does not finalize iCKB UDT balance, CKB capacity, or fees on behalf of the caller.

Callers own the final completion pipeline:

1. Use `getConfig(...).managers.ickbUdt` to finish iCKB UDT completion.
2. Then run CCC-native CKB capacity and fee completion.
3. Only then send the transaction.

## Local CCC Workflow

The shared CCC baseline lives in `forks/ccc/pin/` and materializes into `forks/ccc/repo/`.

Prerequisites: `curl`, `git`, and `jq`.

From a plain checkout:

```bash
git clone git@github.com:ickb/stack.git && cd stack
pnpm forks:bootstrap
pnpm install
pnpm forks:ccc
pnpm check
```

`pnpm check` is the validation gate. It always runs with `CI=true`.

`pnpm forks:ccc` computes the local CCC build surface from the stack's direct `@ckb-ccc/*` dependencies and their current CCC dependency closure, so it avoids rebuilding unrelated packages like `ckb-ccc`, `@ckb-ccc/connector`, `@ckb-ccc/connector-react`, and `@ckb-ccc/lumos-patches`.

To inspect that current CCC surface without building anything:

```bash
pnpm forks:ccc:plan
```

For machine-readable inspection, use `pnpm -s forks:ccc --json`.

For active CCC work, keep built output fresh with:

```bash
pnpm forks:ccc --watch
```

Watch mode keeps the ESM `dist/` output fresh for the closure's `tsc` packages, including `@ckb-ccc/spore`, and prebuilds `@ckb-ccc/did-ckb` plus `@ckb-ccc/type-id` once so `@ckb-ccc/shell` and `@ckb-ccc/ccc` keep resolving against built output. If you change either `tsdown` package, rerun `pnpm forks:ccc`.

For quick consumer-context sanity checks after rebuilding CCC:

```bash
pnpm forks:ccc:smoke
```

That smoke path verifies the current direct Stack import surface through real consumers: `@ckb-ccc/core` from `@ickb/utils`, `@ckb-ccc/udt` from `@ickb/core`, and `@ckb-ccc/ccc` from `apps/interface`.

If you add a new direct `@ckb-ccc/*` dependency to any stack package, add the matching root override in `pnpm-workspace.yaml`. `pnpm check:ccc-overrides` enforces this.

If you need to update or save the shared CCC baseline, use `forks/phroi_forker/repo/` directly. `forks/ccc/pin/manifest` is the source of truth for the shared upstream refs.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and it is released under the [MIT License](./LICENSE).
