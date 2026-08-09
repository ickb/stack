import { describe, expect, it } from "vitest";
import { errorOf } from "../src/client/sdk_error.ts";
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
    expect(sdk.estimateMaturityFeeThreshold({ feeRate: 2n })).toBe(20n);
    expect(sdk.projectAccountAvailability(account, [])).toMatchObject({
      ckbNative,
      ckbAvailable: ckbNative,
      ickbNative: 7n,
      ickbAvailable: 7n,
    });
  });

  it("preserves transparent error causes and JSON-safe messages", () => {
    const message = "plain failure";
    const thrown = {
      amount: 42n,
      validDate: new Date("2026-01-02T03:04:05.000Z"),
      invalidDate: new Date(NaN),
    };
    const error = errorOf(thrown);

    expect(errorOf(message).message).toBe(message);
    expect(errorOf(message).cause).toBe(message);
    expect(error.message).toBe(
      '{"amount":"42","validDate":"2026-01-02T03:04:05.000Z","invalidDate":null}',
    );
    expect(error.cause).toBe(thrown);
  });
});
