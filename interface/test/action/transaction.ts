import { ccc } from "@ckb-ccc/ccc";
import {
  IckbError,
  type ConversionMetadata,
  type ConversionTransactionFailureReason,
} from "@ickb/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Destination } from "../../src/action/destination.ts";
import { buildTransactionPreview } from "../../src/action/transaction.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import {
  buildConversionTransactionMock,
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
  it("delegates planning and completion to the SDK and reports the completed fee", async () => {
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
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(42n);
    const txContext = context({
      system: { ...context().system, feeRate: 9n },
    });
    const config = walletConfigWith({ sdk: { buildConversionTransaction } });

    const txInfo = await buildTransactionPreview(
      txContext,
      true,
      7n,
      own(config),
      config,
    );

    expect(buildConversionTransaction).toHaveBeenCalledTimes(1);
    expect(buildConversionTransaction.mock.calls[0]?.[0]).toBeInstanceOf(ccc.Transaction);
    expect(buildConversionTransaction.mock.calls[0]?.[1]).toEqual({
      direction: "ckb-to-ickb",
      amount: 7n,
      lock: config.primaryLock,
      signer: config.signer,
      context: txContext,
    });
    expect(txInfo).toMatchObject({
      tx,
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

    await buildTransactionPreview(
      context({ ickbAvailable: 5n }),
      false,
      5n,
      own(config),
      config,
    );

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
      buildTransactionPreview(context(), true, 0n, own(config), config),
    ).resolves.toMatchObject({
      conversionKind: kind,
    });
  });
});

describe("buildTransactionPreview failure messages", () => {
  it("maps SDK planner failures to interface copy", async () => {
    const cases: Array<[ConversionTransactionFailureReason, string]> = [
      ["amount-too-small", "Enter a larger amount"],
      ["amount-negative", "Amount cannot be negative"],
      ["insufficient-ckb", "More CKB than you have"],
      ["insufficient-ickb", "More iCKB than you have"],
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
        buildTransactionPreview(
          context({ ckbAvailable: 1n }),
          true,
          1n,
          own(config),
          config,
        ),
      ).resolves.toMatchObject({
        error: message,
        estimatedMaturity: 77n,
      });
    }
  });

  it("names the rounded-up minimum when the SDK reports one", async () => {
    for (const [isCkb2Udt, minimum, message] of [
      [true, 33_222_000_000n, "Enter at least 340 CKB"],
      [true, 1_040_000_000n, "Enter at least 11 CKB"],
      [false, 95n, "Enter at least 0.00000095 iCKB"],
    ] as const) {
      const config = walletConfigWith({
        sdk: {
          buildConversionTransaction: buildConversionTransactionMock({
            ...failedPlan("amount-too-small", 77n),
            minimum,
          }),
        },
      });

      await expect(
        buildTransactionPreview(
          context({ ckbAvailable: 1n }),
          isCkb2Udt,
          1n,
          own(config),
          config,
        ),
      ).resolves.toMatchObject({ error: message });
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
        buildTransactionPreview(
          context({ ckbAvailable: 1n }),
          true,
          amount,
          own(config),
          config,
        ),
      ).resolves.toMatchObject({ error: message, estimatedMaturity: 77n });
    }
  });
});

describe("buildTransactionPreview destination", () => {
  it("hands the destination lock to the SDK and names a move in the preview", async () => {
    const buildConversionTransaction = buildConversionTransactionMock();
    const config = walletConfigWith({ sdk: { buildConversionTransaction } });
    const lock = ccc.Script.from({
      codeHash: config.primaryLock.codeHash,
      hashType: config.primaryLock.hashType,
      args: "0x22",
    });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    const txInfo = await buildTransactionPreview(
      context(),
      true,
      0n,
      { lock, moveTo: "ckt1qzda…abcdef" },
      config,
    );

    expect(buildConversionTransaction.mock.calls[0]?.[1]).toMatchObject({ lock });
    expect(txInfo.moveTo).toBe("ckt1qzda…abcdef");
  });
});

describe("buildTransactionPreview completion", () => {
  it("does not complete locally: the SDK returns the funded transaction", async () => {
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockResolvedValue([0, false]);
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    const config = walletConfigWith({});
    await buildTransactionPreview(
      context({ ckbAvailable: 1n }),
      true,
      1n,
      own(config),
      config,
    );

    expect(completeFeeBy).not.toHaveBeenCalled();
  });
});

describe("buildTransactionPreview thrown failures", () => {
  it("surfaces thrown SDK failures as TxInfo errors", async () => {
    const plannerFailure = walletConfigWith({
      sdk: {
        buildConversionTransaction: vi
          .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
          .mockRejectedValue(new Error("planner failed")),
      },
    });
    await expect(
      buildTransactionPreview(
        context({ ckbAvailable: 1n }),
        true,
        1n,
        own(plannerFailure),
        plannerFailure,
      ),
    ).resolves.toMatchObject({ error: "planner failed" });
  });

  it("names what ran out when completion fails past the planner's checks", async () => {
    for (const [code, message] of [
      [
        "insufficient_capacity",
        "Lower the amount a little: the change cells and the fee need CKB too",
      ],
      ["insufficient_ickb", "More iCKB than you have"],
    ] as const) {
      const config = walletConfigWith({
        sdk: {
          buildConversionTransaction: vi
            .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
            .mockRejectedValue(new IckbError("Insufficient CKB, need 61 more", { code })),
        },
      });
      await expect(
        buildTransactionPreview(
          context({ ckbAvailable: 1n }),
          true,
          1n,
          own(config),
          config,
        ),
      ).resolves.toMatchObject({ error: message });
    }
  });
});

function own(config: Parameters<typeof buildTransactionPreview>[4]): Destination {
  return { lock: config.primaryLock };
}
