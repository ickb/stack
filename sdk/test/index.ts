import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.ts";

describe("sdk package barrel", () => {
  it("exports the conversion workflow and nothing of the layers beneath it", () => {
    for (const name of [
      "DEFAULT_ORDER_FEE",
      "DEFAULT_ORDER_FEE_BASE",
      "IckbError",
      "hasTransactionActivity",
      "IckbSdk",
      "OrderConversionRepresentabilityError",
      "Ratio",
      "TransactionBroadcastError",
      "TransactionWaitError",
      "ickbExchangeRatio",
      "projectConversionTransactionContext",
      "quoteConversion",
      "signAndSendTransaction",
      "signerAccountLocks",
      "waitTransaction",
    ]) {
      expect(sdk).toHaveProperty(name);
    }
    for (const name of [
      "getConfig",
      "OrderManager",
      "completeFirstFundable",
      "estimateConversionOrder",
    ]) {
      expect(sdk).not.toHaveProperty(name);
    }
  });
});
