# iCKB SDK

`@ickb/sdk` builds iCKB conversions on [CCC](https://github.com/ckb-devrel/ccc).

iCKB is CKB locked in the Nervos DAO, as a token you can hold and move. Deposit CKB and get iCKB. It keeps earning the DAO interest the whole time. Turn it back into CKB whenever you want. The SDK reads your account, picks the most direct way to convert, builds and funds the transaction, then checks it before you send it.

## How it works

A conversion goes one of two ways, often both in the same transaction:

- **Direct:** CKB to iCKB is a DAO deposit into the iCKB pool. It gives you a receipt, which your next transaction turns into iCKB. iCKB to CKB withdraws a pool deposit that's close to its claim, so you get the CKB at that claim date.
- **Order:** a limit order a bot fills, for whatever the direct way can't cover. It pays a 0.01% fee and often fills within minutes, as long as the bot has the other side.

The bot also keeps the pool deposits spread across the roughly 30 days of a DAO cycle, so a withdrawal usually finds one close to its claim.

Every transaction also collects what's ready: receipts, matured withdrawals and orders the bot won't fill. So converting again, or converting zero, picks up what's waiting.

## Install

```sh
pnpm add @ickb/sdk @ckb-ccc/core
```

CCC is a peer dependency, so the SDK runs on your own copy of CCC. The SDK targets ES2024: Node 22 or later, or a browser that ships `Promise.withResolvers` (for a web app, `"browserslist": ["baseline widely available"]` covers it).

Everything comes through one namespace, like `ccc`: `import { ickb } from "@ickb/sdk"` gives you `ickb.datesOf(...)` and so on.

## Quickstart

Set up a client for one chain. The SDK has no instance or chain setting: completion reads the chain from the signer's client.

```ts
import { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

// A bigger cache than the CCC default: a pool and a book span more blocks than it holds.
const client = ccc.ClientPublicTestnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
```

`CACHE_SIZES` is just numbers in the constructor's order: cells, transactions, blocks. If the app reads other things through the same client, add its own needs on top.

`ickb.readState(signer)` reads one flat state: what a wallet shows and what a conversion plans with. It scans every address the signer reports, asking again on each read, and sends every output a conversion creates to the signer's recommended lock (`state.changeLock`).

Convert, send and wait:

```ts
async function convert(
  signer: ccc.Signer,
  direction: ickb.ConversionDirection, // "ckb-to-ickb" or "ickb-to-ckb"
  amount: bigint, // the asset you give, in 8-decimal units
) {
  const state = await ickb.readState(signer);
  const built = await ickb.buildConversionTransaction({
    direction,
    amount,
    signer,
    state,
  });
  if (!built.ok) {
    throw new Error(`Cannot convert: ${built.reason}`);
  }
  // Pass the whole result: it carries the fee limit and, for withdrawals, the deadline.
  const sent = await ickb.signAndSendTransaction(signer, built);
  if (!sent.ok && sent.reason !== "maybe-sent") {
    throw new Error(`Not sent: ${sent.reason}`, { cause: sent });
  }
  // Sent, or maybe: a lost answer may still have reached the node, so watch the hash.
  const done = await ickb.waitTransaction(signer.client, sent.txHash);
  if (!done.ok) {
    throw new Error(`Not confirmed: ${done.reason}`, { cause: done });
  }
  return sent.txHash;
}
```

Expected outcomes come back as values: a failed build is `{ ok: false, reason, …that reason's fields }`, for example `insufficient-ckb`, or `amount-too-small` with `built.minimum`, the smallest amount that works. A `cause` appears only where a caught call's rejection is carried. A throw is a defect: a node that can't answer, an answer that fails a check, an unsupported network, or misuse such as a negative amount, an unknown direction or a collection with nothing to collect. An abort throws the signal's own reason.

## Recipes

**Max buttons:** the state already knows how much each side can convert. For CKB it sets aside the cells and the fee a conversion needs:

```ts
function maxAmount(state: ickb.State, direction: ickb.ConversionDirection) {
  return direction === "ckb-to-ickb" ? state.ckbConvertible : state.ickbConvertible;
}
```

**Collect only:** an amount of zero collects what's ready, without converting anything new. `state.hasCollectable` tells you if there's anything, so you can enable the button; with nothing to collect the build throws:

```ts
await convert(signer, "ckb-to-ickb", 0n);
```

**Pool and rate:** `state.poolCkb` and `state.poolIckb` total the iCKB pool, and `state.apyPercent` is the nominal yearly DAO rate in percent ([how it's read](docs/state_read.md#pool-and-apy)).

**Dates:** `built.estimatedMaturity` is when that conversion is ready. `state.estimatedMaturity` is when everything already converting is. For a list of positions, date each one with `datesOf`, which gives when it was created and when it's ready:

```ts
function pendingDates(state: ickb.State) {
  return [...state.pendingOrders, ...state.pendingWithdrawals].map((position) =>
    ickb.datesOf(position, state),
  );
}
```

Dates are unix ms. A `readyAt` at or before `state.tip.timestamp` means ready now. A position kept from an older read dates against the state you pass: an order is found there by its master, so fills since count, and one that's gone is ready now.

**History:** `readHistory(signer)` lists the account's conversions, newest first. It reads lazily, so stopping the loop stops the reads:

```ts
async function recentConversions(signer: ccc.Signer, count: number) {
  const entries: ickb.HistoryEntry[] = [];
  for await (const entry of ickb.readHistory(signer)) {
    entries.push(entry);
    if (entries.length === count) {
      break; // no more pages are read
    }
  }
  return entries;
}
```

Each entry has its `txHash`, the block `timestamp` and its `operations`: deposits, withdrawals and orders, with their CKB and iCKB ([what it lists, and what it doesn't](docs/history.md)).

**Outcomes worth handling:** the send and the wait return values, each reason with its next step:

- `not-signed`: the user declined, or the wallet failed; `cause` says which. Offer to sign again.
- `expired`: the chain got too close to a withdrawal's claim while you signed. Nothing went out: build it again.
- `maybe-sent`: the broadcast's answer got lost, but the node may have the transaction. Watch `txHash`; never resend, since a resend can't tell what became of the first copy.
- `rejected`: the node refused the transaction for good, its reason in `detail` when it gave one. Nothing was spent: build it again.
- `timed-out`: the window closed before the transaction committed. It may still confirm: wait on the same hash again.

A build the account can't fund is a value too: `insufficient-capacity`, with CCC's capacity error as `cause`, when the CKB for the cells and the fee runs out, and `insufficient-ickb` when the iCKB cells fall short.

These examples live in [`test/readme_examples.ts`](test/readme_examples.ts), which the gate typechecks and runs.

## Good to know

- **Nodes aren't trusted:** every header and transaction the SDK reads is checked against its hash. The send checks the inputs, the body and the fee before anything goes out. Pass a plain client: the SDK wraps it.
- **Transactions tidy up:** a conversion spends every cell it's offered, up to one transaction's share of each kind ([limits of one transaction](docs/projection.md#the-limits-of-one-transaction)). So it spends more cells than the amount needs, on purpose, and an account with thousands of cells compacts over several conversions.
- **Direct first, always an order:** the SDK prefers a known claim date and no order fee, even when an order might fill sooner, but every conversion also mints an order for at least part of the amount ([why](docs/transaction_completion.md#always-an-order)).
- **Withdrawals have a deadline:** a plan that withdraws pool deposits must be sent before their claims get too close. Past it, the send returns `expired` and you build again.

## Learn more

The [docs](docs/README.md) explain how each part works and why: the state read, node trust, the projection, the plan walk, funding, signing, confirmation and the estimates.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/tree/master/sdk) and released under the [MIT License](../LICENSE).
