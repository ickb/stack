import { describe, expect, it } from "vitest";
import { projectAccountAvailability } from "../src/conversion/sdk_projection.ts";
import * as sdk from "../src/index.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
} from "./conversion/withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk package barrel", () => {
  it("exports the conversion workflow and nothing of the layers beneath it", () => {
    for (const name of [
      "DEFAULT_ORDER_FEE",
      "DEFAULT_ORDER_FEE_BASE",
      "IckbError",
      "IckbSdk",
      "OrderConversionRepresentabilityError",
      "Ratio",
      "TransactionBroadcastError",
      "TransactionWaitError",
      "ickbExchangeRatio",
      "isIckbError",
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
      "IckbSdkL1",
    ]) {
      expect(sdk).not.toHaveProperty(name);
    }
  });

  it("routes runtime behavior through package exports", () => {
    const capacityCell = plainCapacityCell(5n);
    const udtCell = nativeUdtCell(7n);
    const account = {
      capacityCells: [capacityCell],
      nativeUdtCells: [udtCell],
      nativeUdtCapacity: udtCell.cellOutput.capacity,
      nativeUdtBalance: 7n,
      receipts: [],
      withdrawalGroups: [],
    };
    const ckbNative = capacityCell.cellOutput.capacity;

    const configured: sdk.IckbSdk = sdk.IckbSdk.fromChain("testnet");
    expect(configured.constructor.name).toBe("IckbSdk");
    expect(
      projectAccountAvailability(account, { available: [], pending: [] }),
    ).toMatchObject({
      ckbNative,
      ckbAvailable: ckbNative,
      ickbNative: 7n,
      ickbAvailable: 7n,
    });
  });
});
