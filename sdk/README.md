# iCKB SDK

Turn CKB into iCKB and back, in a few lines of TypeScript on [CCC](https://github.com/ckb-devrel/ccc)!!

iCKB is CKB locked in the Nervos DAO, as a token you can hold and move. It keeps earning the DAO interest the whole time. Turn it back into CKB whenever you want! `@ickb/sdk` reads the account, plans the most direct conversion, then builds, funds and checks the transaction before it goes out.

## How it works

A conversion goes one or both of two ways:

- **Direct:** CKB to iCKB is a DAO deposit into the iCKB pool. It gives a receipt, which your next transaction turns into iCKB. iCKB to CKB withdraws a pool deposit close to its claim, so the CKB arrives at that claim date.
- **Order:** a limit order the bot fills, often within minutes, as long as it holds the other side.

Every transaction also collects what's ready: receipts, matured withdrawals and orders the bot won't fill.

## Install

```sh
pnpm add @ickb/sdk @ckb-ccc/core
```

CCC is a peer dependency. The SDK targets ES2023: every supported Node, or Safari 16, Chrome 110, Firefox 115 and newer.

## Set up a client

No SDK instance, no chain to pick: the SDK follows the client of the signer.

```ts
import { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

// A bigger cache than the CCC default: the pool and the order book span many blocks.
export const client = ccc.ClientPublicTestnet.open({
  cache: new ccc.ClientCacheMemory(...ickb.CACHE_SIZES),
}).value;
```

## Convert

One read gives the whole picture: balances, Max, every position, the pool and the DAO rate, all plain fields. Then quote, build and commit, which signs, sends and watches it to its outcome:

```ts
import { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

export async function convertMax(signer: ccc.Signer): Promise<void> {
  const direction = "ckb-to-ickb";
  const state = await ickb.readState(signer);
  const amount = state.ckbConvertible; // the most CKB one transaction can convert
  console.log("Max:", ccc.fixedPointToString(amount), "CKB");
  console.log("APY:", state.apyPercent.toFixed(2), "%");

  const quote = ickb.quoteConversion(state.exchangeRatio, direction, amount);
  if (!quote.ok) {
    console.log("Can't quote:", failureMessage(quote));
    return;
  }
  console.log("You get:", ccc.fixedPointToString(quote.convertedAmount), "iCKB");

  const built = await ickb.buildConversionTransaction(signer, state, direction, amount);
  if (!built.ok) {
    console.log("Can't build:", failureMessage(built));
    return;
  }

  // One step at a time until the last; a break stops watching, not the transaction.
  for await (const step of ickb.commitTransaction(signer, built)) {
    const { txHash, cause } = step;
    const outcome = step.ok ? step.status : step.reason;
    switch (outcome) {
      case "sent":
        console.log("Sent:", txHash);
        break;
      case "pending":
        // A read or a broadcast failed; the next step tries again.
        if (cause !== undefined) {
          console.log("Retrying:", cause.message);
        }
        break;
      case "committed":
        console.log("Committed:", txHash);
        break;
      case "not-signed":
        console.log("Not signed:", cause?.message); // offer to sign again
        break;
      case "expired":
        console.log("The withdrawal deadline came first, nothing was sent: build again");
        break;
      case "abandoned":
        console.log("Deadline passed, no longer sent; an earlier copy may still land");
        break;
      case "rejected":
        console.log("Rejected:", cause?.message ?? "the node gave no reason");
        break;
      default:
        unhandled(outcome);
    }
  }
}

type Failure =
  | Extract<ickb.QuoteConversionResult, { ok: false }>
  | Extract<ickb.ConversionTransactionResult, { ok: false }>;

function failureMessage(failure: Failure): string {
  switch (failure.reason) {
    case "unrepresentable":
      return "no order can express this amount";
    case "amount-too-small":
      return `enter at least ${ccc.fixedPointToString(failure.minimum)} CKB`;
    case "insufficient-ckb":
      return "more CKB than you have";
    case "insufficient-ickb":
      return "more iCKB than you have";
    case "insufficient-capacity":
      return "not enough spare CKB for the cells and the fee";
    default:
      return unhandled(failure);
  }
}

// An outcome a later SDK adds fails to compile here, rather than going unhandled.
function unhandled(outcome: never): never {
  throw new Error("Unhandled outcome", { cause: outcome });
}
```

Every call takes what it reads from first, the signer then the state. Every outcome an app should handle comes back as a value with its `reason`, so one exhaustive `switch` is the whole error handling:

- **quote:** `unrepresentable`, an amount no order can express (zero included).
- **build:** `insufficient-ckb`, `insufficient-ickb`, `insufficient-capacity`, or `amount-too-small` with the `minimum` that works.
- **commit:** a step per `next()`. `sent` once with the `txHash`, then `pending` (a `cause` is a failed read or send being retried) until `committed`, or a last `ok: false` step: `not-signed` (offer to sign again), `expired` (nothing was sent: build again), `abandoned` (past the deadline and no longer sent, though an earlier copy may still land) or `rejected` (its `cause` says why). A `break` stops watching, not the transaction ([confirmation](docs/confirmation.md)).

An amount of zero collects what's ready without converting anything new: `state.hasCollectable` says whether there's anything.

## Dates and history

Every position knows when it was made and when it's ready. The history spans every address of the wallet:

```ts
import type { ccc } from "@ckb-ccc/core";
import { ickb } from "@ickb/sdk";

export async function datesAndHistory(signer: ccc.Signer): Promise<void> {
  const state = await ickb.readState(signer);
  for (const position of [...state.pendingOrders, ...state.pendingWithdrawals]) {
    const { createdAt, readyAt } = ickb.datesOf(state, position);
    console.log("Made", new Date(Number(createdAt)), "ready", new Date(Number(readyAt)));
  }

  // Newest first, across every address of the wallet; a break stops the reads.
  for await (const { timestamp, operations } of ickb.readHistory(signer)) {
    const kinds = operations.map((op) => op.kind);
    console.log(new Date(Number(timestamp)), kinds);
  }
}
```

Dates are unix ms: a `readyAt` at or before `state.tip.timestamp` means ready now.

## Good to know

- **Nodes aren't trusted:** every header and transaction the SDK reads is checked against its hash. The send checks the inputs, the body and the fee before anything goes out.
- **Throws are bugs:** a node that can't answer, an answer that fails a check, or misuse such as a negative amount. An abort throws the reason of its signal.
- **Every conversion has an order:** the most direct plan first, plus a limit order the bot fills for at least part of the amount, at a 0.01% fee.
- **Transactions tidy up:** each one also collects receipts, matured withdrawals and orders the bot won't fill. It always stays within what one transaction can carry.

The [docs](docs/README.md) explain how each part works and why.

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/tree/master/sdk) and released under the [MIT License](../LICENSE).
