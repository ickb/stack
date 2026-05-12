import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { describe, expect, it } from "vitest";
import {
  CKB,
  CKB_RESERVE,
  MIN_ICKB_BALANCE,
  NEAR_READY_LOOKAHEAD_MS,
  partitionPoolDeposits,
  planRebalance,
  TARGET_ICKB_BALANCE,
} from "./policy.js";

const FUTURE_RING_LENGTH_MS = 16n;

const TIP = {
  epoch: {
    toUnix: (): bigint => 0n,
    add: (): { toUnix: () => bigint } => ({
      toUnix: (): bigint => FUTURE_RING_LENGTH_MS,
    }),
  },
} as never;

function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
): {
  udtValue: bigint;
  maturity: { toUnix: () => bigint };
} {
  return {
    udtValue,
    maturity: {
      toUnix: (): bigint => maturityUnix,
    },
  };
}

function futureDeposit(
  maturityUnix: bigint,
  udtValue = ICKB_DEPOSIT_CAP,
  options?: {
    isReady?: boolean;
  },
): {
  udtValue: bigint;
  maturity: { toUnix: () => bigint };
  isReady?: boolean;
} {
  return {
    ...readyDeposit(udtValue, maturityUnix),
    isReady: options?.isReady,
  };
}

const NO_NEAR_READY: never[] = [];
const NO_FUTURE: never[] = [];

describe("partitionPoolDeposits", () => {
  it("keeps not-ready deposits before the near-ready window out of future coverage", () => {
    const ready = futureDeposit(2n, ICKB_DEPOSIT_CAP, { isReady: true });
    const notReadyBeforeWindow = futureDeposit(8n);
    const nearReady = futureDeposit(16n);
    const future = futureDeposit(16n + NEAR_READY_LOOKAHEAD_MS);

    expect(
      partitionPoolDeposits(
        [future, nearReady, notReadyBeforeWindow, ready] as never[],
        TIP,
        FUTURE_RING_LENGTH_MS,
      ),
    ).toEqual({
      ready: [ready],
      nearReady: [nearReady],
      future: [future],
    });
  });
});

describe("planRebalance", () => {
  it("does nothing when fewer than two output slots remain", () => {
    expect(
      planRebalance({
        outputSlots: 1,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("requests one deposit when iCKB is too low and CKB reserve is available", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("requests one deposit when CKB is exactly at the reserve boundary", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 1000n * CKB + CKB_RESERVE,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does nothing when iCKB is too low but the CKB reserve is unavailable", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 1999n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not deposit when iCKB is exactly at the minimum balance", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: MIN_ICKB_BALANCE,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("seeds one future deposit when no future anchors exist", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: [futureDeposit(105n * 60n * 1000n)] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not seed when a lone future anchor must be preserved", () => {
    const loneAnchor = futureDeposit(9n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [loneAnchor] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("seeds, without withdrawing, when two future anchors crowd the same adaptive segment", () => {
    const firstDuplicate = futureDeposit(9n);
    const secondDuplicate = futureDeposit(10n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [firstDuplicate, secondDuplicate] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not seed when two future anchors already span both adaptive segments", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(1n), futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("seeds when the coarse target segment is under-covered by udt per meter", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(9n), futureDeposit(13n)] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not seed when the coarse target segment meets the density threshold", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [
          futureDeposit(1n, 1n),
          futureDeposit(5n, 3n),
          futureDeposit(9n, 4n),
        ] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not seed from zero-total future coverage", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(9n, 0n), futureDeposit(10n, 0n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not seed future shaping when the reserve gate fails", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not seed when one more deposit would cross the target band", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not treat sparse next-hour near-ready as future-segmentation coverage", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: [futureDeposit(105n * 60n * 1000n)] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not withdraw from a duplicate dense future segment to fill an empty target segment", () => {
    const firstDuplicate = futureDeposit(5n);
    const secondDuplicate = futureDeposit(6n);
    const otherSegment = futureDeposit(9n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [firstDuplicate, secondDuplicate, otherSegment] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("keeps direct seeding when future crowding has only deposit output slots", () => {
    expect(
      planRebalance({
        outputSlots: 3,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not withdraw stale ready-shaped entries from the future pool", () => {
    const readyDuplicate = futureDeposit(5n, ICKB_DEPOSIT_CAP, { isReady: true });
    const pendingDuplicate = futureDeposit(6n);
    const secondPendingDuplicate = futureDeposit(7n);
    const otherSegment = futureDeposit(9n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [readyDuplicate, pendingDuplicate, secondPendingDuplicate, otherSegment] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not treat ready entries as future anchors", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [
          futureDeposit(5n, ICKB_DEPOSIT_CAP, { isReady: true }),
          futureDeposit(6n, ICKB_DEPOSIT_CAP, { isReady: true }),
          futureDeposit(9n),
        ] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("keeps direct seeding when removing a future source would leave the source segment below the preservation floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [
          futureDeposit(5n, 50n),
          futureDeposit(6n, 50n),
          futureDeposit(9n, 200n),
          futureDeposit(13n, 200n),
        ] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("keeps direct seeding when density improvement would be too small", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [
          futureDeposit(1n, 10n),
          futureDeposit(4n),
          futureDeposit(4n),
          futureDeposit(4n),
          futureDeposit(5n),
          futureDeposit(5n),
          futureDeposit(9n, 10n),
        ] as never[],
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("returns none, not a withdrawal, when dust crowds the future pool without deposit budget", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n, 1n), futureDeposit(6n, 1n), futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not reserve withdrawals when public drain leaves the future target under-covered", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(9n, 1n), futureDeposit(13n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not expand future horizon or remove a farther source", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n), futureDeposit(10_000n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns none when a raced future-removal source disappears", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not treat pending future withdrawal value as liquid CKB for future seeding", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: [futureDeposit(105n * 60n * 1000n, 10n * ICKB_DEPOSIT_CAP)] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does nothing instead of withdrawing for cosmetic future smoothing", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [
          futureDeposit(1n),
          futureDeposit(4n),
          futureDeposit(8n),
          futureDeposit(12n),
        ] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not seed or withdraw future inventory when the reserve gate fails", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not seed or withdraw future inventory when one more deposit would cross the target band", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("requests withdrawals when iCKB is above the target band and a crowded-bucket fit exists", () => {
    const first = readyDeposit(4n, 20n * 60n * 1000n);
    const second = readyDeposit(6n, 25n * 60n * 1000n);
    const third = readyDeposit(5n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 9n,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [first, second, third] as never[],
      nearReadyDeposits: NO_NEAR_READY,
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toEqual({
      kind: "withdraw",
      deposits: [first],
      requiredLiveDeposits: [second],
    });
  });

  it("prefers thinning crowded ready buckets before isolated deposits", () => {
    const singleton = readyDeposit(5n, 0n);
    const crowdedEarly = readyDeposit(4n, 20n * 60n * 1000n);
    const crowdedLate = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [singleton, crowdedEarly, crowdedLate] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [crowdedEarly],
      requiredLiveDeposits: [crowdedLate],
    });
  });

  it("pins protected crowded anchors for ordinary extra withdrawals", () => {
    const protectedAnchor = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const extra = readyDeposit(ICKB_DEPOSIT_CAP - CKB, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP - CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [extra, protectedAnchor] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [extra],
      requiredLiveDeposits: [protectedAnchor],
    });
  });

  it("still prefers a crowded-bucket fit before touching singleton anchors", () => {
    const singleton = readyDeposit(5n, 0n);
    const crowdedProtected = readyDeposit(6n, 20n * 60n * 1000n);
    const crowdedExtra = readyDeposit(5n, 25n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 5n,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [crowdedExtra, crowdedProtected, singleton] as never[],
      nearReadyDeposits: NO_NEAR_READY,
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits.map((deposit) => deposit.udtValue) : []).toEqual([crowdedExtra.udtValue]);
  });

  it("protects isolated singleton anchors while moderate excess can still thin a crowded bucket", () => {
    const singleton = readyDeposit(5n, 0n);
    const crowdedLarge = readyDeposit(9n, 20n * 60n * 1000n);
    const crowdedSmall = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 9n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [singleton, crowdedLarge, crowdedSmall] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [crowdedSmall],
      requiredLiveDeposits: [crowdedLarge],
    });
  });

  it("spends singleton anchors again once excess reaches one deposit step above target", () => {
    const singleton = readyDeposit(5n, 0n);
    const crowdedLarge = readyDeposit(9n, 20n * 60n * 1000n);
    const crowdedSmall = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 9n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [singleton, crowdedLarge, crowdedSmall] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [singleton, crowdedSmall],
      requiredLiveDeposits: [crowdedLarge],
    });
  });

  it("ranks crowded buckets by overfull value before smaller crowded buckets", () => {
    const lowExtra = readyDeposit(3n, 20n * 60n * 1000n);
    const lowProtected = readyDeposit(5n, 25n * 60n * 1000n);
    const highExtra = readyDeposit(4n, 40n * 60n * 1000n);
    const highProtected = readyDeposit(5n, 44n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 4n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [lowExtra, lowProtected, highExtra, highProtected] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [highExtra],
      requiredLiveDeposits: [highProtected],
    });
  });

  it("leaves one deposit in a crowded ready bucket when that already reduces excess", () => {
    const first = readyDeposit(3n, 20n * 60n * 1000n);
    const last = readyDeposit(3n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 6n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [first, last] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [first],
      requiredLiveDeposits: [last],
    });
  });

  it("keeps the latest deposit when crowded bucket values tie", () => {
    const earlier = readyDeposit(3n, 20n * 60n * 1000n);
    const later = readyDeposit(3n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 3n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [earlier, later] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [earlier],
      requiredLiveDeposits: [later],
    });
  });

  it("keeps singleton anchors when only they remain under moderate excess", () => {
    const earlierSingleton = readyDeposit(5n, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(5n, 45n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [earlierSingleton, laterSingleton] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("uses near-ready refill as a tie-break for equal singleton choices once anchors unlock", () => {
    const earlierSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const nearReadyRefill = readyDeposit(4n, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [earlierSingleton, laterSingleton] as never[],
        nearReadyDeposits: [nearReadyRefill] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "withdraw", deposits: [laterSingleton] });
  });

  it("uses near-ready refill as a tie-break for equal crowded-bucket extras", () => {
    const firstExtra = readyDeposit(4n, 20n * 60n * 1000n);
    const firstProtected = readyDeposit(5n, 25n * 60n * 1000n);
    const secondExtra = readyDeposit(4n, 40n * 60n * 1000n);
    const secondProtected = readyDeposit(5n, 44n * 60n * 1000n);
    const nearReadyRefill = readyDeposit(3n, 105n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 4n,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [firstExtra, firstProtected, secondExtra, secondProtected] as never[],
      nearReadyDeposits: [nearReadyRefill] as never[],
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits.map((deposit) => deposit.udtValue) : []).toEqual([secondExtra.udtValue]);
  });

  it("ignores near-ready refill exactly at the lookahead cutoff", () => {
    const earlierSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const atCutoff = readyDeposit(4n, 120n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [earlierSingleton, laterSingleton] as never[],
      nearReadyDeposits: [atCutoff] as never[],
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits.map((deposit) => deposit.udtValue) : []).toEqual([earlierSingleton.udtValue]);
  });

  it("ignores near-ready refill just outside the one-hour lookahead", () => {
    const earlierSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const outsideLookahead = readyDeposit(4n, 121n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [earlierSingleton, laterSingleton] as never[],
      nearReadyDeposits: [outsideLookahead] as never[],
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits.map((deposit) => deposit.udtValue) : []).toEqual([earlierSingleton.udtValue]);
  });

  it("returns none for tiny excess with a near-cap crowded extra", () => {
    const singleton = readyDeposit(5n, 0n);
    const crowdedEarly = readyDeposit(ICKB_DEPOSIT_CAP - 1n, 20n * 60n * 1000n);
    const crowdedLate = readyDeposit(ICKB_DEPOSIT_CAP, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [singleton, crowdedEarly, crowdedLate] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns none when neither extras nor singletons fit", () => {
    const singleton = readyDeposit(6n, 0n);
    const crowdedProtected = readyDeposit(6n, 20n * 60n * 1000n);
    const crowdedExtra = readyDeposit(7n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [crowdedExtra, crowdedProtected, singleton] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("limits withdrawal requests by the available output slots", () => {
    const first = readyDeposit(3n, 0n);
    const second = readyDeposit(3n, 20n * 60n * 1000n);
    const third = readyDeposit(3n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 5,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 10n,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits: [first, second, third] as never[],
      nearReadyDeposits: NO_NEAR_READY,
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toEqual({
      kind: "withdraw",
      deposits: [first, second],
    });
  });

  it("caps withdrawal requests at thirty deposits", () => {
    const readyDeposits = Array.from(
      { length: 31 },
      (_, index) => readyDeposit(1n, BigInt(index) * 20n * 60n * 1000n),
    ) as never[];

    const plan = planRebalance({
      outputSlots: 100,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 100n,
      ckbBalance: 0n,
      depositCapacity: 1000n,
      readyDeposits,
      nearReadyDeposits: NO_NEAR_READY,
      futurePoolDeposits: NO_FUTURE,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits : []).toHaveLength(30);
  });

  it("does nothing when iCKB is above target but a full withdrawal would cut below the buffer", () => {
    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 3n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [readyDeposit(ICKB_DEPOSIT_CAP + 4n, 0n)] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("cleanup withdraws one over-cap extra and pins its protected anchor", () => {
    const first = futureDeposit(20n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB, { isReady: true });
    const second = futureDeposit(25n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [first, second] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [first],
      requiredLiveDeposits: [second],
    });
  });

  it("does not clean up an exact-cap ready deposit", () => {
    const capBait = futureDeposit(0n, ICKB_DEPOSIT_CAP, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [capBait] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not let cleanup consume a protected crowded ready anchor", () => {
    const tinyExtra = futureDeposit(20n * 60n * 1000n, 1n, { isReady: true });
    const protectedAnchor = futureDeposit(25n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [tinyExtra, protectedAnchor] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({
      kind: "withdraw",
      deposits: [tinyExtra],
      requiredLiveDeposits: [protectedAnchor],
    });
  });

  it("ignores under-cap non-standard bait for cleanup", () => {
    const dustBait = futureDeposit(0n, ICKB_DEPOSIT_CAP - 1n, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [dustBait] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not clean up near-ready or future non-standard deposits", () => {
    const nearReady = futureDeposit(105n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB);
    const future = futureDeposit(10n, ICKB_DEPOSIT_CAP + CKB);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [],
        nearReadyDeposits: [nearReady] as never[],
        futurePoolDeposits: [future] as never[],
      }),
    ).toEqual({ kind: "none" });
  });

  it("requests one ready singleton once anchors unlock and a full withdrawal keeps the target buffer", () => {
    const deposit = readyDeposit(ICKB_DEPOSIT_CAP + CKB, 0n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [deposit] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "withdraw", deposits: [deposit] });
  });

  it("does not request a full withdrawal that would cut below the target buffer", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [readyDeposit(ICKB_DEPOSIT_CAP + 2n * CKB, 0n)] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not let near-ready refill unlock cleanup below the target floor", () => {
    const unsafeReady = futureDeposit(0n, ICKB_DEPOSIT_CAP + 2n * CKB, { isReady: true });
    const hugeNearReady = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [unsafeReady] as never[],
        nearReadyDeposits: [hugeNearReady] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("keeps deposit action exclusive when future seeding gates pass", () => {
    const cleanupReady = futureDeposit(0n, ICKB_DEPOSIT_CAP + CKB, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [cleanupReady] as never[],
        nearReadyDeposits: NO_NEAR_READY,
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "deposit", quantity: 1 });
  });

  it("does not treat near-ready refill as current liquidity budget", () => {
    const unsafeReady = readyDeposit(ICKB_DEPOSIT_CAP + 2n * CKB, 0n);
    const hugeNearReady = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [unsafeReady] as never[],
        nearReadyDeposits: [hugeNearReady] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not let fake near-ready refill unlock singleton anchors before the excess gate", () => {
    const earlierSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const fakeRefill = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP - 1n,
        ckbBalance: 0n,
        depositCapacity: 1000n,
        readyDeposits: [earlierSingleton, laterSingleton] as never[],
        nearReadyDeposits: [fakeRefill] as never[],
        futurePoolDeposits: NO_FUTURE,
      }),
    ).toEqual({ kind: "none" });
  });
});
