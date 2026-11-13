import { afterEach, describe, expect, it, vi } from "vitest";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { findDeposits } from "../../../src/logic.ts";
import { readRawState } from "../../../src/state.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { FeeRateStubClient, anchoredAt } from "../l1_account/support/sdk_l1_support.ts";

// The pool is the test's input, not a scan the client serves.
vi.mock(import("../../../src/logic.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  findDeposits: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readRawState", () => {
  it("scans the pool at the tip and carries the caller's timing policy on the state", async () => {
    vi.mocked(findDeposits).mockResolvedValue([]);
    const tip = headerLike(0n, { timestamp: BigInt(Date.now()) });
    const client = new FeeRateStubClient({
      ...anchoredAt(tip),
      cells: (): never[] => [],
    });

    const { system } = await readRawState(client, [], BOT_LOCK_UP);

    // The scan reads through the SDK's own verified wrapper of the client.
    expect(findDeposits).toHaveBeenCalledWith(expect.anything(), tip);
    expect(system.lockUp).toBe(BOT_LOCK_UP);
  });
});
