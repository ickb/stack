import { describe, expect, it } from "vitest";
import { WALLET_LOCK_UP } from "../../src/dao.ts";
import { apyPercent, readRawState } from "../../src/state.ts";
import { headerLike } from "../transaction/base/support/sdk_core_support.ts";
import { anchoredAt, FeeRateStubClient } from "./l1_account/support/sdk_l1_support.ts";

const AR = 10n ** 16n;
// One block's growth of a 2% year over 1,800-block epochs, six a day.
const GROWTH = 50_735_000n;

/** The nominal yearly percent of `growth` over one block of an epoch `length` blocks long. */
function nominal(growth: bigint, length: number): number {
  return (Number(growth) / Number(AR)) * length * 6 * 365 * 100;
}

describe("apyPercent", () => {
  it("is one block's growth of the accumulated rate times a year of blocks", () => {
    const parent = headerLike(1n, { dao: { c: 0n, ar: AR, s: 0n, u: 0n } });
    const live = headerLike(2n, {
      epoch: [100n, 5n, 1800n],
      dao: { c: 0n, ar: AR + GROWTH, s: 0n, u: 0n },
    });

    expect(apyPercent(live, parent)).toBeCloseTo(nominal(GROWTH, 1800), 9);
    expect(apyPercent(live, parent)).toBeCloseTo(2, 3);
  });

  it("counts a year in the live header's epochs across an epoch boundary", () => {
    const parent = headerLike(1n, {
      epoch: [100n, 1799n, 1800n],
      dao: { c: 0n, ar: AR, s: 0n, u: 0n },
    });
    const live = headerLike(2n, {
      epoch: [101n, 0n, 1600n],
      dao: { c: 0n, ar: AR + GROWTH, s: 0n, u: 0n },
    });

    expect(apyPercent(live, parent)).toBeCloseTo(nominal(GROWTH, 1600), 9);
  });

  it("is read from the live tip and the parent the state is priced at", async () => {
    const parent = headerLike(1n, {
      timestamp: BigInt(Date.now()),
      dao: { c: 0n, ar: AR, s: 0n, u: 0n },
    });
    const live = headerLike(2n, {
      parentHash: parent.hash,
      timestamp: BigInt(Date.now()),
      epoch: [100n, 5n, 1800n],
      dao: { c: 0n, ar: AR + GROWTH, s: 0n, u: 0n },
    });
    const anchored = anchoredAt(parent);
    const client = new FeeRateStubClient({
      ...anchored,
      getTipHeader: async (): Promise<typeof live> => {
        await Promise.resolve();
        return live;
      },
      cells: (): [] => [],
    });

    const { system } = await readRawState(client, [], WALLET_LOCK_UP);

    expect(system.tip).toBe(parent);
    expect(system.apyPercent).toBe(apyPercent(live, parent));
    expect(system.apyPercent).toBeGreaterThan(0);
  });
});
