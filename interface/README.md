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
pnpm --filter ./interface dev
```

The interface resolves workspace `@ickb/*` packages to source during local development. CCC is resolved from installed package dependencies.

The app owns one client per chain on CCC's public endpoints, WebSocket first with HTTPS fallbacks. After any transaction error the interface gives the client a new, empty cache rather than clearing it, because CCC's clear keeps block headers and a deep reorg is possible on CKB, where one pool holds a majority of the hash power; the client keeps its identity, so the pending hash, the failure message and the frozen preview survive. The preview builds a completed transaction, so it follows the amount field only once typing has settled for 300 ms; acting refreshes and rebuilds regardless.

5. Build the interface when you want a production bundle:

```bash
pnpm --filter ./interface build
```

Like `dev`, the build uses workspace package source directly and does not require Stack package `dist` output.

A release of the interface is a merge to the default branch that changes the `version` field of `interface/package.json`: the check workflow then uploads the `interface/dist` it just built and a deploy job publishes it to GitHub Pages at ickb.org, once the gate passed on the same commit, so a failed run leaves the previous deployment live. Other merges leave the site untouched. The `CNAME` in `public/` binds the domain; the repository's Pages source is GitHub Actions.

The interface uses CCC-native wallet connection and transaction submission. Protocol-specific conversion planning and partial transaction construction come from `@ickb/sdk`; the app shows whether signing will collect funds, convert directly, create a standing order, or split the request between a direct conversion and a remainder order. When the user acts, the interface locks that amount and direction, refreshes the exact wallet state, and rebuilds the preview before asking the wallet to sign. After broadcast it displays the transaction hash and observes commitment for one 60-second window. If the transaction is still unconfirmed, the app says it may still confirm and keeps the same transaction available for a same-session confirmation retry without another signature or broadcast. That public hash lives with the wallet session component: it survives the action view remounting on a preview change, and is gone after a page reload or a wallet change. A terminal chain rejection displays its hash and returns the unchanged form for editing and rebuilding.

Form quotes come from `conversionQuote` in `src/shared/quote.ts`, a midpoint order quote at the default order fee. It is an estimate: the preview, built from exact wallet state once typing settles, shows what signing does, a direct conversion, a standing order, or both, and its own output can differ from the quote by the order's rounding.

## Small iCKB Balances

For iCKB-to-CKB requests below the normal order preview threshold, the interface can build a discounted dust order when the SDK finds terms that still cover the matcher incentive threshold. The preview shows the tiny iCKB input, approximate CKB output, and matcher incentive inline before the normal wallet signature. If no actionable dust terms exist, the SDK reports the request as too small instead of creating an unmatchable order. This path is useful when the user mainly wants to recover CKB capacity locked in an iCKB xUDT cell; the user accepts or rejects the exact terms by signing or cancelling the transaction.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../LICENSE).
