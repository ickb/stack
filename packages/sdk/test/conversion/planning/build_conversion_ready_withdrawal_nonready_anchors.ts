import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "../withdrawal_quotes/support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ICKB_TO_CKB = "ickb-to-ckb";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("plans exact ready withdrawals with non-ready required anchors", async () => {
    const { sdk, ownedOwnerManager, lock } = testSdk();
    const extra = projectionReadyDeposit(10n, 0n, { id: "21" });
    const nonReadyAnchor = projectionReadyDeposit(12n, 1n, { id: "22", isReady: false });
    const requestWithdrawal = vi
      .spyOn(ownedOwnerManager, "requestWithdrawal")
      .mockImplementation(
        async (
          ...[txLike, deposits, requestLock, , requestOptions]: [
            txLike: ccc.TransactionLike,
            deposits: unknown,
            requestLock: unknown,
            client: unknown,
            requestOptions: unknown,
          ]
        ) => {
          await Promise.resolve();
          expect(deposits).toEqual([extra]);
          expect(requestLock).toBe(lock);
          expect(requestOptions).toEqual({
            requiredLiveDeposits: [nonReadyAnchor],
          });
          return ccc.Transaction.from(txLike);
        },
      );

    const result = await sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      baseClient,
      {
        direction: ICKB_TO_CKB,
        amount: 10n,
        lock,
        context: conversionContext({
          system: {
            poolDeposits: {
              deposits: [extra, nonReadyAnchor],
              readyDeposits: [extra],
              id: "pool",
            },
          },
          ickbAvailable: 10n,
        }),
      },
    );

    expect(result).toMatchObject({ ok: true, conversion: { kind: "direct" } });
    expect(requestWithdrawal).toHaveBeenCalledTimes(1);
  });
});
