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

Everything is exported twice, like `ccc`: `import { ickb } from "@ickb/sdk"` gives you `ickb.readyAt(...)` and so on. Named imports work too.

## Quickstart

Set up a client and the SDK for one chain:

```ts
import { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

// A bigger cache than the CCC default: a pool and a book span more blocks than it holds.
const client = ccc.ClientPublicTestnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
const sdk = ickb.IckbSdk.fromChain("testnet");
```

`CACHE_SIZES` is just numbers in the constructor's order: cells, transactions, blocks. If the app reads other things through the same client, add its own needs on top.

Read the account, then project it into what a wallet shows and what a conversion plans with:

```ts
async function readAccount(sdk: ickb.IckbSdk, signer: ccc.Signer) {
  const locks = await ickb.signerAccountLocks(signer);
  const { system, userOrders, account } = await sdk.getL1AccountState(
    signer.client,
    locks,
    ickb.WALLET_LOCK_UP,
  );
  // Every output a conversion creates belongs to this lock.
  const changeLock = (await signer.getRecommendedAddressObj()).script;
  return ickb.projectConversionTransactionContext(
    system,
    account,
    userOrders,
    changeLock,
  );
}
```

Convert, send and wait:

```ts
async function convert(
  sdk: ickb.IckbSdk,
  signer: ccc.Signer,
  direction: ickb.ConversionDirection, // "ckb-to-ickb" or "ickb-to-ckb"
  amount: bigint, // the asset you give, in 8-decimal units
) {
  const { context } = await readAccount(sdk, signer);
  const built = await sdk.buildConversionTransaction({
    direction,
    amount,
    signer,
    context,
  });
  if (!built.ok) {
    throw new Error(`Cannot convert: ${built.reason}`);
  }
  // Pass the whole result: it carries the fee limit and, for withdrawals, the deadline.
  const txHash = await ickb.signAndSendTransaction(signer, built);
  await ickb.waitTransaction(signer.client, txHash);
  return txHash;
}
```

A failed build isn't an exception: `built.reason` says why, for example `insufficient-ckb`, or `amount-too-small` with `built.minimum`, the smallest amount that works.

## Recipes

**Max buttons:** the projection already knows how much each side can convert. For CKB it sets aside the cells and the fee a conversion needs:

```ts
function maxAmount(
  projection: ickb.AccountAvailabilityProjection,
  direction: ickb.ConversionDirection,
) {
  return direction === "ckb-to-ickb"
    ? projection.ckbConvertible
    : projection.ickbAvailable;
}
```

**Collect only:** an amount of zero collects what's ready, without converting anything new. `ickb.hasCollectable(context)` tells you if there's anything, so you can enable the button:

```ts
await convert(sdk, signer, "ckb-to-ickb", 0n);
```

**Dates:** `built.estimatedMaturity` is when that conversion is ready. `context.estimatedMaturity` is when everything already converting is. For a list of positions, date each one:

```ts
function pendingDates({
  projection,
  context,
}: ickb.ConversionTransactionContextProjection) {
  return [...projection.pendingOrders, ...projection.pendingWithdrawals].map((position) =>
    ickb.readyAt(position, context.system),
  );
}
```

Dates are unix ms. One at or before `context.system.tip.timestamp` means ready now.

**Errors worth handling:**

```ts
try {
  return await convert(sdk, signer, direction, amount);
} catch (error) {
  if (error instanceof ickb.TransactionBroadcastError) {
    // The answer got lost, but the node may have it: watch the same hash, don't resend.
    await ickb.waitTransaction(signer.client, error.txHash);
    return error.txHash;
  }
  if (
    error instanceof ickb.TransactionExpiredError ||
    error instanceof ickb.TransactionWaitError
  ) {
    // Too close to a claim, or refused for good: nothing was spent, build it again.
    return undefined;
  }
  throw error;
}
```

An `ickb.IckbError` from the build means the account can't fund it: its `code` is `insufficient_capacity` or `insufficient_ickb`.

These examples live in [`test/readme_examples.ts`](test/readme_examples.ts), which the gate typechecks and runs.

## Good to know

- **Nodes aren't trusted:** every header and transaction the SDK reads is checked against its hash. The send checks the inputs, the body and the fee before anything goes out. Pass a plain client: the SDK wraps it.
- **Transactions tidy up:** a conversion also sweeps your other small cells in, up to 1,000 inputs. So it spends more cells than the amount needs, on purpose.
- **Direct first:** the SDK prefers a known claim date and no order fee, even when an order might fill sooner.
- **Withdrawals have a deadline:** a plan that withdraws pool deposits must be sent before their claims get too close. Past it, the send refuses with `TransactionExpiredError` and you build again.

## Learn more

The [docs](docs/README.md) explain how each part works and why: the state read, node trust, the projection, the plan walk, funding, signing, confirmation and the estimates.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/tree/master/sdk) and released under the [MIT License](../LICENSE).
