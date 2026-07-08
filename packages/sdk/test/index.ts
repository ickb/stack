import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
} from "./conversion/withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk package barrel", () => {
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

    expect(sdk.IckbSdk.fromConfig(sdk.getConfig("testnet"))).toBeInstanceOf(sdk.IckbSdk);
    expect(sdk.estimateMaturityFeeThreshold({ feeRate: 2n })).toBe(20n);
    expect(sdk.projectAccountAvailability(account, [])).toMatchObject({
      ckbNative,
      ckbAvailable: ckbNative,
      ickbNative: 7n,
      ickbAvailable: 7n,
    });
  });
});
