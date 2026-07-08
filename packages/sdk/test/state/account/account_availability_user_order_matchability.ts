import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccountAvailability } from "../../../src/sdk.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import { ACCOUNT_AVAILABILITY_SUITE } from "./support/account_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(ACCOUNT_AVAILABILITY_SUITE, () => {
  it("treats non-matchable user orders as actionable", () => {
    const nonMatchable = projectionOrderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: false,
      isMatchable: false,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [nonMatchable],
    );

    expect(projection.availableOrders).toEqual([nonMatchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(23n);
    expect(projection.ickbAvailable).toBe(29n);
  });

  it("keeps matchable non-dual orders pending by default", () => {
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
    );

    expect(projection.availableOrders).toEqual([]);
    expect(projection.pendingOrders).toEqual([matchable]);
    expect(projection.ckbAvailable).toBe(0n);
    expect(projection.ickbAvailable).toBe(0n);
    expect(projection.ckbPending).toBe(31n);
    expect(projection.ickbPending).toBe(37n);
  });
});
