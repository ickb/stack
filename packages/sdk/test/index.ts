import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
} from "./conversion/withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk package barrel", () => {
  it("exports only the concrete SDK class hierarchy entry point", () => {
    expect(sdk.IckbSdk).toBeTypeOf("function");
    expect(sdk.waitTransaction).toBeTypeOf("function");
    expect(sdk).not.toHaveProperty("IckbSdkBase");
    expect(sdk).not.toHaveProperty("IckbSdkConversion");
    expect(sdk).not.toHaveProperty("IckbSdkL1");
    expect(sdk).not.toHaveProperty("sendAndWaitForCommit");
    expect(sdk).not.toHaveProperty("TransactionConfirmationError");
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

    const configured: sdk.IckbSdk = sdk.IckbSdk.fromConfig(sdk.getConfig("testnet"));
    expect(configured).toBeInstanceOf(sdk.IckbSdk);
    expect(configured.constructor.name).toBe("IckbSdk");
    expect(
      sdk.projectAccountAvailability(account, { available: [], pending: [] }),
    ).toMatchObject({
      ckbNative,
      ckbAvailable: ckbNative,
      ickbNative: 7n,
      ickbAvailable: 7n,
    });
  });
});
