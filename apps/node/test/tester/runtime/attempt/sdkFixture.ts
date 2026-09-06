import { describe, expect, it } from "vitest";

import {
  CKB_TO_ICKB_DIRECTION,
  ICKB_TO_CKB_DIRECTION,
  buildSdkConversionTransaction,
  ccc,
  completeTransactionMock,
  requestInfo,
  runtimeDefaultSdk,
  runtimeWithSdk,
  script,
  testerState,
} from "./support.ts";

describe("runtimeDefaultSdk", () => {
  it("provides a deterministic SDK fixture with default state and conversion steps", async () => {
    const sdk = runtimeDefaultSdk();
    const client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
    const state = await sdk.getL1AccountState(client, []);

    expect(state.system.feeRate).toBe(42n);
    expect(state.user.orders).toEqual([]);
    expect(state.account.capacityCells).toEqual([]);

    const tx = sdk.buildBaseTransaction(ccc.Transaction.default());
    const requested = await sdk.request(tx, script("11"), requestInfo(), {
      ckbValue: 1n,
      udtValue: 0n,
    });
    const completed = await sdk.completeTransaction(requested, {
      signer: runtimeWithSdk({}).signer,
      feeRate: 42n,
    });
    const conversion = await sdk.buildConversionTransaction(ccc.Transaction.default(), {
      direction: CKB_TO_ICKB_DIRECTION,
      amount: 1n,
      lock: script("11"),
      signer: runtimeWithSdk({}).signer,
      context: testerState({ availableCkbBalance: 0n }).conversionContext,
    });

    expect(completed).toBeInstanceOf(ccc.Transaction);
    expect(conversion).toMatchObject({
      ok: true,
      estimatedMaturity: 0n,
      conversion: { kind: "order" },
    });
  });

  it("throws when SDK conversion planning fails", async () => {
    const runtime = runtimeWithSdk({
      buildConversionTransaction: async (_txLike, options) => {
        await Promise.resolve();
        return {
          ok: false,
          reason: "nothing-to-do",
          estimatedMaturity: options.context.estimatedMaturity,
        };
      },
    });

    await expect(
      buildSdkConversionTransaction(
        runtime,
        testerState({ availableCkbBalance: 0n }),
        CKB_TO_ICKB_DIRECTION,
        1n,
      ),
    ).rejects.toThrow("SDK conversion failed: nothing-to-do");
  });

  it("omits conversion notice when the SDK does not provide one", async () => {
    const calls: string[] = [];
    const runtime = runtimeWithSdk({
      buildConversionTransaction: async (txLike) => {
        calls.push("conversion");
        await Promise.resolve();
        return {
          ok: true,
          tx: ccc.Transaction.from(txLike),
          estimatedMaturity: 0n,
          conversion: { kind: "order" },
        };
      },
      completeTransaction: completeTransactionMock(calls),
    });

    const result = await buildSdkConversionTransaction(
      runtime,
      testerState({ availableCkbBalance: 0n }),
      ICKB_TO_CKB_DIRECTION,
      1n,
    );

    expect(result).not.toHaveProperty("conversionNotice");
    expect(result.conversion).toEqual({ kind: "order" });
  });
});
