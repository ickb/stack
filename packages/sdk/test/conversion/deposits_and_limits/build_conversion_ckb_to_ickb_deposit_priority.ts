import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseClient,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  BUILD_CONVERSION_TRANSACTION_SUITE,
  testSdk,
} from "./support/sdk_fixture_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";

const DIRECT_PLUS_ORDER = "direct-plus-order";

describe(BUILD_CONVERSION_TRANSACTION_SUITE, () => {
  it("plans CKB-to-iCKB direct deposits before fallback orders", async () => {
    const { sdk, logicManager, orderManager, lock } = testSdk();
    const calls: string[] = [];
    const remainder = ccc.fixedPointFrom(10000);
    const deposit = vi
      .spyOn(logicManager, "deposit")
      .mockImplementation(async (txLike, quantity, depositCapacity, depositLock) => {
        await Promise.resolve();
        calls.push(`deposit:${String(quantity)}`);
        expect(depositCapacity).toBe(ICKB_DEPOSIT_CAP);
        expect(depositLock).toBe(lock);
        const tx = ccc.Transaction.from(txLike);
        tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
        tx.outputsData.push("0x");
        return tx;
      });
    const mint = vi
      .spyOn(orderManager, "mint")
      .mockImplementation((txLike, _lock, _info, amounts) => {
        calls.push("order");
        expect(amounts).toEqual({ ckbValue: remainder, udtValue: 0n });
        const tx = ccc.Transaction.from(txLike);
        expect(tx.outputs).toHaveLength(1);
        tx.outputs.push(ccc.CellOutput.from({ capacity: 2n, lock }));
        tx.outputsData.push("0x");
        return tx;
      });

    const result = await sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      baseClient,
      {
        direction: CKB_TO_ICKB,
        amount: ICKB_DEPOSIT_CAP * 2n + remainder,
        lock,
        context: conversionContext({
          system: { ckbAvailable: ICKB_DEPOSIT_CAP * 3n },
          ckbAvailable: ICKB_DEPOSIT_CAP * 2n + remainder,
          ickbAvailable: 0n,
        }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      conversion: { kind: DIRECT_PLUS_ORDER },
    });
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["deposit:2", "order"]);
  });
});
