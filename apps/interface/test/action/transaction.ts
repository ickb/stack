import { ccc } from "@ckb-ccc/ccc";
import type { ConversionMetadata, ConversionTransactionFailureReason } from "@ickb/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransactionPreview } from "../../src/action/transaction.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import {
  buildConversionTransactionMock,
  completeTransactionMock,
  context,
  failedPlan,
  successfulPlan,
  txWithInput,
  walletConfigWith,
} from "./fixtures/transaction.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransactionPreview", () => {
  it("delegates protocol planning to the SDK and completes the partial transaction", async () => {
    const tx = txWithInput("99");
    const notice = {
      kind: "dust-ickb-to-ckb" as const,
      inputIckb: 1n,
      outputCkb: 1n,
      incentiveCkb: 0n,
      maturityEstimateUnavailable: false,
    };
    const buildConversionTransaction = buildConversionTransactionMock(
      successfulPlan({
        tx,
        estimatedMaturity: 123n,
        conversionNotice: notice,
      }),
    );
    const completeTransaction = completeTransactionMock();
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(42n);
    const txContext = context({
      ckbAvailable: 7n,
      system: { ...context().system, feeRate: 9n },
    });
    const config = walletConfigWith({
      sdk: { buildConversionTransaction, completeTransaction },
    });

    const txInfo = await buildTransactionPreview(txContext, true, 7n, config);

    expect(buildConversionTransaction).toHaveBeenCalledTimes(1);
    expect(buildConversionTransaction.mock.calls[0]?.[0]).toBeInstanceOf(ccc.Transaction);
    expect(buildConversionTransaction.mock.calls[0]?.[1]).toEqual({
      direction: "ckb-to-ickb",
      amount: 7n,
      lock: config.primaryLock,
      context: txContext,
    });
    expect(completeTransaction).toHaveBeenCalledWith(tx, {
      signer: config.signer,
      feeRate: 9n,
    });
    expect(txInfo).toMatchObject({
      error: "",
      fee: 42n,
      estimatedMaturity: 123n,
      conversionNotice: notice,
    });
  });

  it("delegates iCKB-to-CKB direction without leaking app managers", async () => {
    const buildConversionTransaction = buildConversionTransactionMock();
    const config = walletConfigWith({ sdk: { buildConversionTransaction } });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    await buildTransactionPreview(context({ ickbAvailable: 5n }), false, 5n, config);

    expect(buildConversionTransaction.mock.calls[0]?.[1]).toMatchObject({
      direction: "ickb-to-ckb",
      amount: 5n,
    });
  });

  it.each<ConversionMetadata["kind"]>([
    "collect-only",
    "direct",
    "order",
    "direct-plus-order",
  ])("preserves SDK conversion intent %s", async (kind) => {
    const config = walletConfigWith({
      sdk: {
        buildConversionTransaction: buildConversionTransactionMock(
          successfulPlan({ conversion: { kind } }),
        ),
      },
    });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    await expect(
      buildTransactionPreview(context(), true, 0n, config),
    ).resolves.toMatchObject({
      conversionKind: kind,
    });
  });
});

describe("buildTransactionPreview failure messages", () => {
  it("maps SDK planner failures to interface copy", async () => {
    const cases: Array<[ConversionTransactionFailureReason, string]> = [
      ["amount-too-small", "Enter a larger amount"],
      [
        "not-enough-ready-deposits",
        "Not enough ready liquidity. Lower the amount or wait",
      ],
      ["amount-negative", "Amount cannot be negative"],
      ["insufficient-ckb", "Not enough available CKB for this amount"],
      ["insufficient-ickb", "Not enough available iCKB for this amount"],
    ];

    for (const [reason, message] of cases) {
      const config = walletConfigWith({
        sdk: {
          buildConversionTransaction: buildConversionTransactionMock(
            failedPlan(reason, 77n),
          ),
        },
      });

      await expect(
        buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, config),
      ).resolves.toMatchObject({
        error: message,
        estimatedMaturity: 77n,
      });
    }
  });

  it("describes SDK no-op plans by requested amount", async () => {
    for (const [amount, message] of [
      [0n, "Nothing to do"],
      [1n, "No conversion request available for this amount"],
    ] as const) {
      const config = walletConfigWith({
        sdk: {
          buildConversionTransaction: buildConversionTransactionMock(
            failedPlan("nothing-to-do", 77n),
          ),
        },
      });

      await expect(
        buildTransactionPreview(context({ ckbAvailable: 1n }), true, amount, config),
      ).resolves.toMatchObject({ error: message, estimatedMaturity: 77n });
    }
  });
});

describe("buildTransactionPreview completion", () => {
  it("uses SDK completion instead of local UDT, fee, and DAO steps", async () => {
    const calls: string[] = [];
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockImplementation(async () => {
        await Promise.resolve();
        calls.push("fee");
        return [0, false];
      });
    const completeTransaction = vi
      .fn<WalletConfig["sdk"]["completeTransaction"]>()
      .mockImplementation(async (txLike) => {
        calls.push("sdk-complete");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    await buildTransactionPreview(
      context({ ckbAvailable: 1n }),
      true,
      1n,
      walletConfigWith({
        sdk: { completeTransaction },
      }),
    );

    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(completeFeeBy).not.toHaveBeenCalled();
    expect(calls).toEqual(["sdk-complete"]);
  });
});

describe("buildTransactionPreview thrown failures", () => {
  it("surfaces planner and completion failures as TxInfo errors", async () => {
    const plannerFailure = walletConfigWith({
      sdk: {
        buildConversionTransaction: vi
          .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
          .mockRejectedValue(new Error("planner failed")),
      },
    });
    await expect(
      buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, plannerFailure),
    ).resolves.toMatchObject({ error: "planner failed" });

    const completionFailure = walletConfigWith({
      sdk: {
        completeTransaction: vi
          .fn<WalletConfig["sdk"]["completeTransaction"]>()
          .mockRejectedValue(new Error("completion failed")),
      },
    });
    await expect(
      buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, completionFailure),
    ).resolves.toMatchObject({ error: "completion failed" });
  });
});
