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

3. Install dependencies:

```bash
pnpm install
```

4. Start the interface dev server from the repo root:

```bash
pnpm --filter ./apps/interface dev
```

The interface resolves workspace `@ickb/*` packages to source during local development. CCC is resolved from installed package dependencies.

The app-owned mainnet and testnet clients use `https://mainnet.ckb.dev/` and `https://testnet.ckb.dev/` respectively, with no fallback endpoints. After any transaction error the interface hands the connector a fresh client of the same chain, because CCC's cache clear keeps stale block headers; the pending hash and the session's transaction mutex are untouched. The preview builds a completed transaction, so it follows the amount field only once typing has settled for 300 ms; acting refreshes and rebuilds regardless.

5. Build the interface when you want a production bundle:

```bash
pnpm --filter ./apps/interface build
```

Like `dev`, the build uses workspace package source directly and does not require Stack package `dist` output.

Production deployment is intentionally deferred. The repository does not publish this bundle until the Interface is declared production-ready and a root workflow is added with an explicit deployment target.

The interface uses CCC-native wallet connection and transaction submission. Protocol-specific conversion planning and partial transaction construction come from `@ickb/sdk`; the app shows whether signing will collect funds, convert directly, create a standing order, or split the request between a direct conversion and a remainder order. When the user acts, the interface locks that amount and direction, refreshes the exact wallet state, and rebuilds the preview before asking the wallet to sign. After broadcast it displays the transaction hash and observes commitment for one 60-second window. If the transaction is still unconfirmed, the app says it may still confirm and keeps the same transaction available for a same-session confirmation retry without another signature or broadcast. That public hash lives with the wallet session component: it survives the action view remounting on a preview change, and is gone after a page reload or a wallet change. A terminal chain rejection displays its hash and returns the unchanged form for editing and rebuilding.

Form quotes use the same `OrderManager.convert(...)` quote path as SDK planning: the shown output is rounded in the user's favor and the order `info` preserves that full-fill quote when the user signs.

## Small iCKB Balances

For iCKB-to-CKB requests below the normal order preview threshold, the interface can build a discounted dust order when the SDK finds terms that still cover the matcher incentive threshold. The preview shows the tiny iCKB input, approximate CKB output, and matcher incentive inline before the normal wallet signature. If no actionable dust terms exist, the SDK reports the request as too small instead of creating an unmatchable order. This path is useful when the user mainly wants to recover CKB capacity locked in an iCKB xUDT cell; the user accepts or rejects the exact terms by signing or cancelling the transaction.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../../LICENSE).
