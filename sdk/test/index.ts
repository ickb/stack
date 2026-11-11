import { describe, expect, it } from "vitest";
import * as entry from "../src/index.ts";

const sdk = entry.ickb;

describe("sdk package barrel", () => {
  it("exports the ickb namespace alone", () => {
    expect(Object.keys(entry)).toEqual(["ickb"]);
  });

  it("exports the conversion workflow and nothing of the layers beneath it", () => {
    for (const name of [
      "DEFAULT_ORDER_FEE",
      "DEFAULT_ORDER_FEE_BASE",
      "buildConversionTransaction",
      "datesOf",
      "readHistory",
      "exchangeRatioAt",
      "quoteConversion",
      "readState",
      "signAndSendTransaction",
      "waitTransaction",
    ]) {
      expect(sdk).toHaveProperty(name);
    }
    for (const name of [
      "findOrders",
      "hasCollectable",
      "completeFirstFundable",
      "quoteOrder",
      "IckbError",
      "OrderConversionRepresentabilityError",
      "projectConversionTransactionContext",
      "estimateConversionOrder",
      "IckbSdk",
      "buildBaseTransaction",
      "readyAt",
      "Ratio",
      "ickbExchangeRatio",
      "mintOrderOf",
      "TransactionBroadcastError",
      "TransactionExpiredError",
      "TransactionWaitError",
      "projectState",
      "readRawState",
      "signerAccountLocks",
      "WALLET_LOCK_UP",
    ]) {
      expect(sdk).not.toHaveProperty(name);
    }
  });
});
