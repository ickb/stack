import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.ts";

describe("sdk package barrel", () => {
  it("exports the conversion workflow and nothing of the layers beneath it", () => {
    for (const name of [
      "DEFAULT_ORDER_FEE",
      "DEFAULT_ORDER_FEE_BASE",
      "Ratio",
      "buildConversionTransaction",
      "ickbExchangeRatio",
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
