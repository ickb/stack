import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.ts";

describe("sdk package barrel", () => {
  it("exports the conversion workflow and nothing of the layers beneath it", () => {
    for (const name of [
      "DEFAULT_ORDER_FEE",
      "DEFAULT_ORDER_FEE_BASE",
      "IckbSdk",
      "Ratio",
      "TransactionBroadcastError",
      "TransactionWaitError",
      "ickbExchangeRatio",
      "projectState",
      "quoteConversion",
      "signAndSendTransaction",
      "signerAccountLocks",
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
    ]) {
      expect(sdk).not.toHaveProperty(name);
    }
  });
});
