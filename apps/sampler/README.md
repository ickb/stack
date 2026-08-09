# iCKB Sampler

A utility to sample the gross CKB value recoverable from 1 iCKB across time. The value uses the standard 100,000 iCKB deposit and includes its recoverable 82 CKB occupied capacity.

## Run the sampler on mainnet

From a plain checkout, run `pnpm install` from the repo root. CCC is resolved as a normal package dependency, and the app itself runs from TypeScript source under Node 22.19+.

From the repo root:

```bash
pnpm install
pnpm --filter ./apps/sampler start
```

The app-owned mainnet client uses `https://mainnet.ckb.dev/` with no fallback endpoints.

Or from `apps/sampler` inside the monorepo workspace:

```bash
pnpm install
pnpm start
```

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../../LICENSE).
