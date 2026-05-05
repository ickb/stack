# iCKB Interface

iCKB interface built on top of CCC and the workspace `@ickb/*` packages.

## Run locally

1. Clone the monorepo:

```bash
git clone https://github.com/ickb/stack.git
```

2. Enter the repo root:

```bash
cd stack
```

3. Install dependencies and materialize the local CCC workspace:

```bash
pnpm forks:bootstrap
pnpm install
pnpm forks:ccc
```

4. Start the interface dev server from the repo root:

```bash
pnpm --filter ./apps/interface dev
```

That script builds the workspace `@ickb/*` package `dist/` outputs first because the interface resolves those packages to their built CCC-compatible entrypoints during local development.

5. Build the interface when you want a production bundle:

```bash
pnpm --filter ./apps/interface build
```

Like `dev`, the build script refreshes those workspace package `dist/` outputs first so a clean checkout does not rely on stale generated files.

The interface now uses CCC-native wallet connection and transaction completion. Protocol-specific transaction construction comes from `@ickb/sdk`, then the app completes iCKB UDT balance, CKB capacity, and fees before sending.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../../LICENSE).
