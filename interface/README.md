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

The interface uses CCC-native wallet connection and transaction submission. Protocol-specific conversion planning and partial transaction construction come from `@ickb/sdk`; the app shows whether signing will collect funds, convert directly, create a standing order, or split the request between a direct conversion and a remainder order. When the user acts, the interface locks that amount and direction, refreshes the exact wallet state, and rebuilds the preview before asking the wallet to sign. After broadcast it displays the transaction hash and observes commitment for one 60-second window; a send whose answer from the node was lost enters the same window on the hash it recorded before sending, since the node may hold the transaction and only its status can tell. If the transaction is still unconfirmed, the app says it may still confirm and keeps the same transaction available for a same-session confirmation retry without another signature or broadcast. That public hash lives with the wallet session component: it survives the action view remounting on a preview change, and is gone after a page reload or a wallet change. A terminal chain rejection displays its hash and returns the unchanged form for editing and rebuilding.

Every transaction the user signs also collects their converted funds: fulfilled orders, matured withdrawals, receipts, and any order the market will never fill or that has sat on the book for thirty days, whatever the reason (dust under a bot's fill cost, a remainder another matcher left, an ask above the market); such an order is melted and its funds come back (decisions amendments 52(z), 52(am)). The header's address is the destination, prefilled with the wallet's own and editable. Its lock owns every cell the next transaction creates for the user, and completion sweeps the wallet's liquid cells along, so a transaction to another address sends the wallet's CKB and iCKB there, the way out to another wallet for key-only wallets with no xUDT transfer of their own. It carries only native CKB and iCKB, never a converting position, since the new wallet may not read those, and so it takes no amount: once the address is another wallet's, the amount reads "0" with "all CKB and iCKB go to the address above" under it, max and the direction switch are off, and the typed amount comes back when the address is cleared. The button reads "send all CKB and iCKB" and the status line says what is sent, that funds still converting stay here to be collected from this wallet later, and "run it again until everything has been sent" when the size budget left cells behind (a large account may need several transactions; iCKB cells go first, plain CKB last, so the fee is always covered). The word "move" is not used on screen: it named nothing the user knows. The address reads as plain text with "cannot change during the transaction" under it while a transaction is prepared, signed or awaited. A withdrawal request selects pool deposits claiming two hours to three days out and is sent only while ninety minutes remain before the earliest claim (`WALLET_LOCK_UP`, in epochs, one fresh tip read after signing): a user may leave the wallet's popup open for a while, and a request committed after its claim would lock the deposit for another cycle. Past that, nothing is sent and the status line reads "The withdrawal timing changed while you were signing. Nothing was sent. Review the refreshed preview and sign again." The field lives in React state only, so a reload or a wallet change resets it (decisions amendments 52(af), 52(al)). The balance row shows, per asset, what is "in wallet", for CKB the capacity of every liquid cell including the iCKB cells, and what is "converting", in receipts, withdrawals or orders, or "collectable" once all of it returns with the next transaction; "max" under the source asset sets the iCKB in wallet plus the collectable part, and CKB has no Max because a request at the full CKB figure never funds: the change cells, an order's master cell and the fee take capacity on top (decisions amendments 52(ah), 52(ai)).

Form quotes come from `conversionQuote` in `src/view/formState.ts`, a midpoint order quote at the default order fee. It is an estimate: the preview, built from exact wallet state once typing settles, shows what signing does, a direct conversion, a standing order, or both, and its own output can differ from the quote by the order's rounding.

## Small iCKB Balances

For iCKB-to-CKB requests below the normal order preview threshold, the interface can build a discounted dust order when the SDK finds terms that still cover the matcher incentive threshold. The preview shows the tiny iCKB input, approximate CKB output, and matcher incentive inline before the normal wallet signature. If no actionable dust terms exist, the SDK reports the request as too small instead of creating an unmatchable order. This path is useful when the user mainly wants to recover CKB capacity locked in an iCKB xUDT cell; the user accepts or rejects the exact terms by signing or cancelling the transaction.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack) and it is released under the [MIT License](../LICENSE).
