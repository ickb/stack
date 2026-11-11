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
    console.log("Can't quote:", quote.reason);
    return;
  }
  console.log("You get:", ccc.fixedPointToString(quote.convertedAmount), "iCKB");

  const built = await ickb.buildConversionTransaction(signer, state, direction, amount);
  if (!built.ok) {
    console.log("Can't build:", built.reason);
    return;
  }

  const sent = await ickb.signAndSendTransaction(signer, built);
  if (!sent.ok && sent.reason !== "maybe-sent") {
    console.log("Not sent:", sent.reason);
    return;
  }

  // A lost answer may still have reached the node, so a maybe-sent hash is watched too.
  const done = await ickb.waitTransaction(signer.client, sent.txHash);
  if (!done.ok) {
    console.log("Not confirmed:", done.reason);
    return;
  }
  console.log("Confirmed:", sent.txHash);
}
```

One read, then quote, build, sign and send, wait. Every outcome an app should handle comes back as a value, so one `if` per step is the whole error handling. The [SDK README](sdk/README.md) has the rest: the client setup, dates, history and what each outcome means.

## What's inside

- [`@ickb/sdk`](sdk/README.md): the package above, browser-ready, with CCC as its only dependency.
- [The bot](sdk/node/README.md): it fills orders and keeps the pool deposits spread across the DAO cycle, so withdrawals find CKB close at hand.
- [The app](interface/README.md): the one at [ickb.org](https://ickb.org), every CCC wallet welcome.

Every header and transaction the SDK reads is checked against its hash before anything gets signed. Every transaction stays within what the deployed scripts accept. Contributors start from the [working agreement](AGENTS.md).

## Licensing

This source code, crafted with care by [Phroi](https://phroi.com/), is freely available on [GitHub](https://github.com/ickb/stack/) and released under the [MIT License](LICENSE).
