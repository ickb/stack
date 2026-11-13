# iCKB Stack

iCKB is CKB locked in the Nervos DAO, as a token you can hold and move. It keeps earning the DAO interest the whole time. Turn it back into CKB whenever you want!

This repository is the whole iCKB stack on [CCC](https://github.com/ckb-devrel/ccc): the `@ickb/sdk` package, the liquidity bot and the app running at [ickb.org](https://ickb.org).

## Convert in a few lines

```sh
pnpm add @ickb/sdk @ckb-ccc/core
```

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

One read, then quote, build and commit: sign, send and watch it to its outcome. Every outcome an app should handle comes back as a value, so one exhaustive `switch` is the whole error handling. The [SDK README](sdk/README.md) has the rest: the client setup, dates, history and what each outcome means.

## What's inside

- [`@ickb/sdk`](sdk/README.md): the package above, browser-ready, with CCC as its only dependency.
- [The bot](sdk/node/README.md): it fills orders and keeps the pool deposits spread across the DAO cycle, so withdrawals find CKB close at hand.
- [The app](interface/README.md): the one at [ickb.org](https://ickb.org), every CCC wallet welcome.

Every header and transaction the SDK reads is checked against its hash before anything gets signed. Every transaction stays within what the deployed scripts accept. Contributors start from the [working agreement](AGENTS.md).

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and released under the [MIT License](LICENSE).
