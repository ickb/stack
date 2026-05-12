# iCKB Sampler

An utility to help sampling iCKB rate across time.

## Run the sampler on mainnet

From a plain checkout, follow the root [Local CCC Workflow](../../README.md#local-ccc-workflow) first so `forks/ccc/repo` is materialized. If you are working against patched local CCC packages, rerun `pnpm forks:ccc` or keep `pnpm forks:ccc --watch` running. The app build commands below then build the runtime workspace package closure they import.

From the repo root:

```bash
pnpm install
pnpm --filter ./apps/sampler build
pnpm --filter ./apps/sampler start
```

Or from `apps/sampler` inside the monorepo workspace:

```bash
pnpm install
pnpm build
pnpm start
```

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../../LICENSE).
