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
