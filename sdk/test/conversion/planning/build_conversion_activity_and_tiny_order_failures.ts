import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseTip,
  conversionContext,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  mockPassthroughMint,
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderWithdrawal } from "../withdrawal_quotes/support/sdk_cell_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const CKB_TO_ICKB = "ckb-to-ickb";
const ICKB_TO_CKB = "ickb-to-ckb";

const AMOUNT_TOO_SMALL = "amount-too-small";
const FULL_WORKSPACE_TIMEOUT_MS = 20_000;
describe("IckbSdk.buildConversionTransaction", () => {
  it("returns typed failures for invalid requested amounts", async () => {
    const { sdk } = testSdk();

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: -1n,
        signer: stubSigner,
        context: conversionContext(),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "amount-negative" });
    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 2n,
        signer: stubSigner,
        context: conversionContext({ ckbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ckb" });
    await expect(
      sdk.buildConversionTransaction({
        direction: ICKB_TO_CKB,
        amount: 2n,
        signer: stubSigner,
        context: conversionContext({ ickbAvailable: 1n }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "insufficient-ickb" });
  });

  it("returns typed failures for no activity and tiny orders", async () => {
    const { sdk } = testSdk();

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 0n,
        signer: stubSigner,
        context: conversionContext(),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "nothing-to-do",
    });

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 1n,
        signer: stubSigner,
        context: conversionContext({
          ckbAvailable: 1n,
          ickbAvailable: 0n,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      // Ten mining fees at fee rate 1, plus one, at the 0.01% order fee.
      minimum: 110_000n,
    });
    await expect(
      sdk.buildConversionTransaction({
        direction: ICKB_TO_CKB,
        amount: 1n,
        signer: stubSigner,
        context: conversionContext({ ickbAvailable: 1n }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: AMOUNT_TOO_SMALL,
      // A sell can pay its whole value as fee: ten mining fees plus one, at par.
      minimum: 11n,
    });
  });

  it("returns collect-only success when the collection has activity", async () => {
    const { sdk, lock, ownedOwnerManager } = testSdk();
    vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.addOutput({ lock }, "0x");
      return tx;
    });

    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 0n,
        signer: stubSigner,
        context: conversionContext({
          readyWithdrawals: [placeholderWithdrawal],
          // A collection takes only what is ready, so it is done at the tip.
          estimatedMaturity: 99n,
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      conversionKind: "collect-only",
      estimatedMaturity: baseTip.timestamp,
    });
  });

  it("finds nothing to do at amount zero without anything to collect", async () => {
    const { sdk } = testSdk();
    const cell = ccc.Cell.from({
      outPoint: { txHash: `0x${"78".repeat(32)}`, index: 0 },
      cellOutput: { capacity: ccc.fixedPointFrom(200), lock: script("11") },
      outputData: "0x",
    });

    // Liquid cells alone would only be compacted, which is not worth a fee.
    await expect(
      sdk.buildConversionTransaction({
        direction: CKB_TO_ICKB,
        amount: 0n,
        signer: stubSigner,
        context: conversionContext({ cells: [cell] }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "nothing-to-do" });
  });
});

describe("IckbSdk.buildConversionTransaction order-only paths", () => {
  it(
    "builds an order-only iCKB-to-CKB conversion while collecting ready withdrawals",
    async () => {
      const { sdk, orderManager, ownedOwnerManager } = testSdk();
      mockPassthroughMint(orderManager);
      vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation((txLike) =>
        ccc.Transaction.from(txLike),
      );

      await expect(
        sdk.buildConversionTransaction({
          direction: ICKB_TO_CKB,
          amount: ccc.fixedPointFrom(1),
          signer: stubSigner,
          context: conversionContext({
            readyWithdrawals: [placeholderWithdrawal],
            ickbAvailable: ccc.fixedPointFrom(1),
          }),
        }),
      ).resolves.toMatchObject({ ok: true, conversionKind: "order" });
    },
    FULL_WORKSPACE_TIMEOUT_MS,
  );
});
