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

The app creates one client per chain using CCC's public endpoints. The SDK verifies what it reads through them and bounds the tip's parent, where it prices, by the wallet policy's thirty minutes ([node trust](../sdk/docs/node_trust.md#the-tip-parent)), so a browser clock more than thirty minutes fast fails the account state, and with it every transaction, until corrected. The quote shown before a wallet connects reads the tip directly, unverified: it is display only, and every transaction is priced from the verified state read. The connector owns the selected client: both the landing tabs and the wallet modal switch it through `setClient`, and the gate derives the chain from that client. A separate draft chain would undo the user's network choice when the connector drops its signer during a switch.

The connector offers every CCC signer, with install links for wallets the browser lacks. CCC signs CKB transactions from EVM wallets through Omnilock in EVM mode and PW-Lock, from BTC wallets through Omnilock in BTC mode, and from Nostr through the Nostr lock; the account reads every lock the signer reports. A filter that kept only CKB signers hid MetaMask, OKX, UniSat, Xverse and Nostr, so it was removed. The gate still waits while the signer's client is on another chain. The automated tests and the private-key harness exercise only CKB signers; an EVM or BTC wallet is checked by hand with a real wallet.

`WalletConfigGate` reads the recommended address and account locks once per signer/root configuration, with an explicit retry after failure. It ignores results that arrive after that configuration changes. This is component state rather than a refetching query: tab-focus refetches used to replace script objects and remount the action view during signing. Account changes rely on the connector replacing the signer; a wallet that does not report its change needs a reload.

After a transaction error, the app gives the client a new cache object. CCC's `clear()` retains old block headers, which may be stale after a deep reorg. Keeping the client identity avoids remounting the wallet session and losing its pending hash, failure message and frozen preview. The pending transaction is session-only: it survives an action-view remount but not a page reload or wallet change.

## Converting and collecting

The interface describes conversions by when funds return: direct actions have a claim date; standing orders depend on a bot. One [estimated date](../sdk/docs/pool_maturity_estimates.md) covers the wallet's converting funds and the new request. A position list or completed-history index would add protocol bookkeeping without another action the user needs here.

Form quotes use `conversionQuote` in `src/view/formState.ts`, at the SDK's [default order fee](../sdk/src/conversion/estimate.ts). Every order from the interface therefore asks the same price, apart from a [dust order](#balances), and none can buy priority: a [bot fills by price](../sdk/node/docs/policy.md#matching-makes-progress-from-available-inventory), at equal price in an order of its choosing, and only while it holds the other side, so no order is promised eventual service; an order the bot would not take whole comes back with the next transaction, as below. The intent line says "when a bot fills it" for that reason. The completed preview shows the actual plan: a direct conversion, a standing order, or both. Its rounded output can differ from the form quote. The SDK chooses the [first fundable direct-first plan](../sdk/docs/transaction_completion.md#the-plan-walk), not the plan with the earliest estimated completion.

Every transaction also collects fulfilled orders, receipts and matured withdrawals, subject to the SDK's batch limits. The intent line of a collection says whether a withdrawal or order stays converting after it: the button reads the same either way, and the balance row's "converting" word alone went unnoticed when a receipt was collected while its sibling order was still open. Live orders join that collection when the bot's current whole-fill profitability rule refuses them in both directions (`isCollectable`), judged at the fee rate the wallet's picker chose: Auto is the node's sampled rate, Economy the 1000 floor, Custom whatever the user typed. A bot that caps its rate lower than the chosen one may still fill an order this rule collects; the user gets the funds back less the fee, so the app does not guess at any bot's cap. A fee spike refuses a sell as it refuses a buy. No age cutoff backs the rule: one would refund only a fillable order the bot has stopped filling, and the bot is watched. The SDK applies the rule when it projects the state, so the app and the generator cannot disagree; it lives in [`sdk/src/order/fill.ts`](../sdk/src/order/fill.ts). They do not cancel an ordinary live conversion merely because the user signs again or its estimated date passes; an outage must not make collection silently cancel every waiting order. Setting the amount to zero collects what is ready without requesting a new conversion.

### Balances

CKB "in wallet" includes the capacity of both plain cells and iCKB cells. Counting only plain cells showed zero for accounts whose iCKB cells could fund the transaction. The figure matches liquid capacity, not an amount that can all be converted: change, an order master and fees still need CKB. CKB Max therefore uses the SDK's `ckbConvertible`, which sets those aside, and iCKB Max uses `ickbAvailable`; both include collectable funds. While there is no CKB to convert, testnet shows the faucet in CKB Max's place.

Balances show two decimals, truncated so a figure never exceeds what the wallet holds; the accessible label keeps the exact value. Full precision made wide screens read like "400,333.11456155 in wallet". Phones compact from 100,000 ("123.45K") to fit a third of the card; the constant `PHONE_COMPACT_FROM` in `src/view/Form.tsx` records the measurement.

An order holds its own cell space beside the amount it converts: a 2,000 CKB order showed 2,295 CKB converting, then 295 CKB collectable, and nothing on screen said why. The status of a preview that mints an order names that capacity, the SDK's `orderOccupiedCapacity`, and says collection returns it. The balance figures still count it, since the wallet holds it.

For iCKB-to-CKB requests below the normal order threshold, the SDK can build a discounted dust order when it finds actionable terms; if none exist, it asks for a larger amount. This can help recover the CKB capacity backing a small iCKB cell. Its order fee is about ten times the fee rate in shannons (0.0001 CKB at the 1,000 floor), above the default fee, so the form's quote overstates its output by that difference. The status no longer names those terms: for the 0.003 iCKB remainder of a 100,000 iCKB withdrawal it spent a sentence on a negligible part, and the preview already shows the transaction fee.

## Preview, signing and confirmation

React Query owns chain reads and transaction previews. A preview completes a real transaction, so it follows the amount after 300 ms without another edit. Clicking the action freezes the draft, refreshes wallet state and rebuilds before requesting a signature. Withdrawal timing uses [`WALLET_LOCK_UP`](../sdk/src/dao.ts), whose wider margins allow for a wallet popup left open; the SDK checks a fresh epoch deadline after signing.

After broadcast, the app watches the transaction's local hash for one 60-second window at depth zero. A lost send response enters the same wait because the node may already hold the transaction. A timeout retains the frozen preview and hash for a same-session confirmation retry, without another signature or broadcast. A terminal rejection displays its hash and releases the unchanged form for editing. Confirmation invalidates the account query and clears the request and pending hash. The [SDK confirmation contract](../sdk/docs/confirmation.md) owns status reads and timeout behavior.

The last attempt's failure stays visible until another attempt starts or the draft changes. Tying it to the sampled state's identity made a rejection disappear at the next poll. The status uses one reserved line rather than adding a second failure row that moves the form.

Real Rei-wallet behavior when completion tries several candidate prefixes remains unverified; the automated completion tests do not establish whether that wallet prompts again.

## Layout

Views keep the order form, action, chart. Putting the chart between the form and its button pushed the action below the fold. Reserved section heights keep feedback from moving the controls; accent color marks actionable elements rather than inert balances. The app loads together because the landing quote already needs the SDK, so a lazy shell would add a serial load without a useful boundary.

## Deployment

A [version-changing release](../README.md#releases) builds `interface/dist` again in a fresh job where none of the gate's tooling runs, and deploys it. A failed check leaves the previous site live.

The domain `ickb.org` is the repository's Pages setting; with the Actions source GitHub ignores a `CNAME` file, so none is shipped. `public/favicon.png` is the only static file copied to the site root; files added under `public/` are published as-is.
