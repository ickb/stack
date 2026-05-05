import { describe, expect, it } from "vitest";
import { planRebalance, selectReadyDeposits, TARGET_ICKB_BALANCE } from "./policy.js";

describe("selectReadyDeposits", () => {
  it("keeps the cumulative selection under the target amount", () => {
    const deposits = [{ udtValue: 4n }, { udtValue: 7n }, { udtValue: 3n }];

    expect(selectReadyDeposits(deposits, 10n)).toEqual([
      { udtValue: 4n },
      { udtValue: 3n },
    ]);
  });

  it("respects the request limit", () => {
    const deposits = [{ udtValue: 1n }, { udtValue: 1n }, { udtValue: 1n }];

    expect(selectReadyDeposits(deposits, 10n, 2)).toEqual([
      { udtValue: 1n },
      { udtValue: 1n },
    ]);
  });
});

describe("planRebalance", () => {
  it("does nothing when fewer than two output slots remain", () => {
    expect(
      planRebalance({
        outputSlots: 1,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositAmount: 1000n * 100000000n,
        readyDeposits: [],
      }),
    ).toEqual({ kind: "none" });
  });

  it("requests one deposit when iCKB is too low and CKB reserve is available", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositAmount: 1000n * 100000000n,
        readyDeposits: [],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does nothing when iCKB is too low but the CKB reserve is unavailable", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        ickbBalance: 0n,
        ckbBalance: 1999n * 100000000n,
        depositAmount: 1000n * 100000000n,
        readyDeposits: [],
      }),
    ).toEqual({ kind: "none" });
  });

  it("requests withdrawals when iCKB is above the target band", () => {
    const plan = planRebalance({
      outputSlots: 6,
      ickbBalance: TARGET_ICKB_BALANCE + 9n,
      ckbBalance: 0n,
      depositAmount: 1000n,
      readyDeposits: [
        { udtValue: 4n },
        { udtValue: 6n },
        { udtValue: 5n },
      ] as never[],
    });

    expect(plan).toEqual({
      kind: "withdraw",
      deposits: [{ udtValue: 4n }, { udtValue: 5n }],
    });
  });

  it("does nothing when iCKB is above target but no ready deposits fit", () => {
    expect(
      planRebalance({
        outputSlots: 6,
        ickbBalance: TARGET_ICKB_BALANCE + 3n,
        ckbBalance: 0n,
        depositAmount: 1000n,
        readyDeposits: [{ udtValue: 4n }] as never[],
      }),
    ).toEqual({ kind: "none" });
  });
});
