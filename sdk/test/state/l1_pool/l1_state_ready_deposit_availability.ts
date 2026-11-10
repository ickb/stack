import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAO, ICKB_LOGIC } from "../../../src/constants.ts";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { findDeposits } from "../../../src/logic.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { anchoredAt, FeeRateStubClient } from "../l1_account/support/sdk_l1_support.ts";

// The pool is the test's input, not a scan the client serves.
vi.mock(import("../../../src/logic.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  findDeposits: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getL1AccountState", () => {
  it("carries the pool deposits, judged against the tip, as the CKB supply", async () => {
    const readyDeposit = depositCell(
      "03",
      ICKB_LOGIC,
      DAO,
      headerLike(0n),
      headerLike(0n),
      {
        isReady: true,
      },
    );
    vi.mocked(findDeposits).mockResolvedValue([readyDeposit]);
    const sdk = new IckbSdk();
    const tip = headerLike(1n, {
      epoch: ccc.Epoch.from([181n, 0n, 1n]),
      timestamp: BigInt(Date.now()),
    });
    const client = new FeeRateStubClient({
      ...anchoredAt(tip),
      cells: (): ccc.Cell[] => [],
    });

    const state = await sdk.getL1AccountState(client, [], WALLET_LOCK_UP);

    expect(vi.mocked(findDeposits).mock.calls[0]?.[1]).toBe(tip);
    expect(state.system.poolDeposits).toEqual([readyDeposit]);
  });
});
