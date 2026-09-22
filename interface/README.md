# iCKB Interface

The browser app uses CCC for wallet connection and `@ickb/sdk` for conversion planning, completion and submission.

## Run locally

From the repository root, using the [workspace toolchain](../README.md#dependencies-and-checks):

```bash
pnpm install --frozen-lockfile
pnpm --filter ./interface dev
```

For a production bundle:

```bash
pnpm --filter ./interface build
```

Both commands use the workspace SDK source directly; no SDK `dist/` build is needed. CCC comes from installed dependencies.

## Wallet session and client

The app creates one client per chain using CCC's public endpoints. The connector owns the selected client: both the landing tabs and the wallet modal switch it through `setClient`, and the gate derives the chain from that client. A separate draft chain would undo the user's network choice when the connector drops its signer during a switch.

`WalletConfigGate` reads the recommended address and account locks once per signer/root configuration, with an explicit retry after failure. It ignores results that arrive after that configuration changes. This is component state rather than a refetching query: tab-focus refetches used to replace script objects and remount the action view during signing. Account changes rely on the connector replacing the signer; a wallet that does not report its change needs a reload.

After a transaction error, the app gives the client a new cache object. CCC's `clear()` retains old block headers, which may be stale after a deep reorg. Keeping the client identity avoids remounting the wallet session and losing its pending hash, failure message and frozen preview. The pending transaction is session-only: it survives an action-view remount but not a page reload or wallet change.

## Converting and collecting

The interface describes conversions by when funds return: direct actions have a claim date; standing orders depend on a bot. One [estimated date](../sdk/docs/pool_maturity_estimates.md) covers the wallet's converting funds and the new request. A position list or completed-history index would add protocol bookkeeping without another action the user needs here.

Form quotes use `conversionQuote` in `src/view/formState.ts`, at the SDK's [default order fee](../sdk/src/conversion/estimate.ts). The completed preview shows the actual plan: a direct conversion, a standing order, or both. Its rounded output can differ from the form quote. The SDK chooses the [first fundable direct-first plan](../sdk/README.md#transaction-completion), not the plan with the earliest estimated completion.

Every transaction also collects fulfilled orders, receipts and matured withdrawals, subject to the SDK's batch limits. Live orders join that collection when:

- a CKB-to-iCKB buy fails the bot's current whole-fill profitability rule (`isRefused`);
- either direction reaches the block-age cutoff, nominally thirty days (`isStale`).

DAO growth makes a refused buy less attractive, whereas it can make a sell profitable later. Sells therefore wait for the age cutoff even if the bot would not fill them today. The shared rules live in [`sdk/src/order/fill.ts`](../sdk/src/order/fill.ts). They do not cancel an ordinary live conversion merely because the user signs again or its estimated date passes; an outage must not make collection silently cancel every waiting order. Setting the amount to zero collects what is ready without requesting a new conversion.

### Sending to another wallet

The address field defaults to the connected wallet and stays in React state only. Its lock owns the user outputs of the next transaction, including change. This gives key-only wallets without an xUDT transfer screen a way to send their CKB and iCKB to a Nervos-native wallet. The destination never signs, so a second connection or tandem signer is unnecessary.

For a foreign destination, the amount becomes zero and the direction switch and Max are disabled. The transaction sends native CKB and iCKB, including funds collected in that transaction; it leaves still-converting positions with the source wallet because the destination wallet may not understand them. Clearing the destination restores the typed amount. The address is fixed while a transaction is prepared, signed or awaited.

Completion deliberately sweeps liquid cells. A large account can exceed its size budget, so the status asks the user to run the send again until everything has been sent. iCKB cells are swept before plain CKB, with plain cells available for fee completion. The [SDK funding rules](../sdk/README.md#funding-and-compaction) own that order and its limits.

### Balances and small amounts

CKB "in wallet" includes the capacity of both plain cells and iCKB cells. Counting only plain cells showed zero for accounts whose iCKB cells could fund the transaction. The figure matches liquid capacity, not an amount that can all be converted: change, an order master and fees still need CKB. There is therefore no CKB Max; completion reports a shortfall before signing. iCKB Max uses the SDK's bound, including collectable funds.

For iCKB-to-CKB requests below the normal order threshold, the SDK can build a discounted dust order when it finds actionable terms. The status shows the small input, approximate output and conversion cost before signing. If no such terms exist, it asks for a larger amount. This can help recover the CKB capacity backing a small iCKB cell.

## Preview, signing and confirmation

React Query owns chain reads and transaction previews. A preview completes a real transaction, so it follows the amount after 300 ms without another edit. Clicking the action freezes the draft, refreshes wallet state and rebuilds before requesting a signature. Withdrawal timing uses [`WALLET_LOCK_UP`](../sdk/src/dao.ts), whose wider margins allow for a wallet popup left open; the SDK checks a fresh epoch deadline after signing.

After broadcast, the app watches the locally recorded hash for one 60-second window at depth zero. A lost send response enters the same wait because the node may already hold the transaction. A timeout retains the frozen preview and hash for a same-session confirmation retry, without another signature or broadcast. A terminal rejection displays its hash and releases the unchanged form for editing. Confirmation invalidates the account query and clears the request and pending hash. The [SDK confirmation contract](../sdk/README.md#confirmation) owns status reads and timeout behavior.

The last attempt's failure stays visible until another attempt starts or the draft changes. Tying it to the sampled state's identity made a rejection disappear at the next poll. The status uses one reserved line rather than adding a second failure row that moves the form.

Real Rei-wallet behavior when completion tries several candidate prefixes remains unverified; the automated completion tests do not establish whether that wallet prompts again.

## Layout

Views keep the order form, action, chart. Putting the chart between the form and its button pushed the action below the fold. Reserved section heights keep feedback from moving the controls; accent color marks actionable elements rather than inert balances. The app loads together because the landing quote already needs the SDK, so a lazy shell would add a serial load without a useful boundary.

## Deployment

A [version-changing release](../README.md#releases) deploys the `interface/dist` bundle produced by the successful check job. A failed check leaves the previous site live.

Before the first deployment, set this repository's Pages source to GitHub Actions and attach `ickb.org` here, detaching it from `ickb/legacy-lumos-interface`. Archive that repository after the new site is live. `public/CNAME` records the domain; `public/favicon.png` is the other static file copied to the site root. Files added under `public/` are published as-is.
