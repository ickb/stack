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

The interface now uses CCC-native wallet connection and transaction completion. Protocol-specific conversion planning and partial transaction construction come from `@ickb/sdk`; the app maps domain results to UI copy, calls `sdk.completeTransaction(...)`, and then sends.

## Small iCKB Balances

For iCKB-to-CKB requests below the normal order preview threshold, the interface automatically builds a discounted dust order instead of adding another confirmation step. The preview shows the tiny iCKB input, approximate CKB output, and matcher incentive inline before the normal wallet signature. This path is useful when the user mainly wants to recover CKB capacity locked in an iCKB xUDT cell; the user accepts or rejects the exact terms by signing or cancelling the transaction.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../../LICENSE).
