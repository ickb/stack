import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/order";
import type {
  ConversionTransactionFailureReason,
  ConversionTransactionResult,
} from "@ickb/sdk";
import { byte32FromByte } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransactionPreview } from "./transaction.ts";
import type { TransactionContext } from "./transaction.ts";
import type { WalletConfig } from "./utils.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>
>;
type CompleteTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["completeTransaction"]>
>;
type SuccessfulPlan = Extract<ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ConversionTransactionResult, { ok: false }>;

afterEach(() => {
  vi.restoreAllMocks();
});

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function context(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: { timestamp: 0n } as ccc.ClientBlockHeader,
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    capacityCells: [],
    nativeUdtCells: [],
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function resolvedTx(txLike: ccc.TransactionLike): Promise<ccc.Transaction> {
  return Promise.resolve(ccc.Transaction.from(txLike));
}

function completeTransactionMock(): CompleteTransactionMock {
  return vi.fn<WalletConfig["sdk"]["completeTransaction"]>().mockImplementation(resolvedTx);
}

function txWithInput(txHashByte: string): ccc.Transaction {
  const tx = ccc.Transaction.default();
  tx.inputs.push(
    ccc.CellInput.from({
      previousOutput: {
        txHash: byte32FromByte(txHashByte),
        index: 0n,
      },
    }),
  );
  return tx;
}

function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    estimatedMaturity: 0n,
    conversion: { kind: "order" },
    ...overrides,
  };
}

function failedPlan(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity = 0n,
): FailedPlan {
  return { ok: false, reason, estimatedMaturity };
}

function buildConversionTransactionMock(
  result: ConversionTransactionResult = successfulPlan(),
): BuildConversionTransactionMock {
  return vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>().mockResolvedValue(result);
}

function walletConfig(overrides: Partial<WalletConfig> = {}): WalletConfig {
  return {
    chain: "testnet",
    cccClient: {} as ccc.Client,
    queryClient: {} as WalletConfig["queryClient"],
    signer: {} as ccc.Signer,
    address: "ckt1test",
    accountLocks: [],
    primaryLock: script("11"),
    sdk: {
      buildConversionTransaction: buildConversionTransactionMock(),
      completeTransaction: resolvedTx,
    } as unknown as WalletConfig["sdk"],
    ...overrides,
  };
}

interface WalletConfigTestOverrides {
  sdk?: Partial<WalletConfig["sdk"]>;
}

function walletConfigWith(overrides: WalletConfigTestOverrides): WalletConfig {
  const base = walletConfig();
  return walletConfig({
    sdk: Object.assign({}, base.sdk, overrides.sdk),
  });
}

describe("buildTransactionPreview", () => {
  it("validates user amounts before delegating to the SDK planner", async () => {
    const buildConversionTransaction = buildConversionTransactionMock();
    const config = walletConfigWith({ sdk: { buildConversionTransaction } });

    await expect(buildTransactionPreview(context(), true, -1n, config))
      .resolves.toMatchObject({ error: "Amount must be positive" });
    await expect(buildTransactionPreview(context({ ckbAvailable: 1n }), true, 2n, config))
      .resolves.toMatchObject({ error: "Not enough CKB" });
    await expect(buildTransactionPreview(context({ ickbAvailable: 1n }), false, 2n, config))
      .resolves.toMatchObject({ error: "Not enough iCKB" });
    expect(buildConversionTransaction).not.toHaveBeenCalled();
  });

  it("delegates protocol planning to the SDK and completes the partial transaction", async () => {
    const tx = txWithInput("99");
    const notice = {
      kind: "dust-ickb-to-ckb" as const,
      inputIckb: 1n,
      outputCkb: 1n,
      incentiveCkb: 0n,
      maturityEstimateUnavailable: false,
    };
    const buildConversionTransaction = buildConversionTransactionMock(successfulPlan({
      tx,
      estimatedMaturity: 123n,
      conversionNotice: notice,
    }));
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
    expect(buildConversionTransaction.mock.calls[0]?.[1]).toBe(config.cccClient);
    expect(buildConversionTransaction.mock.calls[0]?.[2]).toEqual({
      direction: "ckb-to-ickb",
      amount: 7n,
      lock: config.primaryLock,
      context: txContext,
    });
    expect(completeTransaction).toHaveBeenCalledWith(tx, {
      signer: config.signer,
      client: config.cccClient,
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

    expect(buildConversionTransaction.mock.calls[0]?.[2]).toMatchObject({
      direction: "ickb-to-ckb",
      amount: 5n,
    });
  });

  it("maps SDK planner failures to interface copy", async () => {
    const cases: [ConversionTransactionFailureReason, string][] = [
      ["amount-too-small", "Amount too small to exceed the minimum match and fee threshold"],
      ["not-enough-ready-deposits", "Not enough ready deposits to convert now"],
      ["nothing-to-do", "Nothing to do for now"],
      ["amount-negative", "Amount must be positive"],
      ["insufficient-ckb", "Not enough CKB"],
      ["insufficient-ickb", "Not enough iCKB"],
    ];

    for (const [reason, message] of cases) {
      const config = walletConfigWith({
        sdk: { buildConversionTransaction: buildConversionTransactionMock(failedPlan(reason, 77n)) },
      });

      await expect(buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, config))
        .resolves.toMatchObject({ error: message, estimatedMaturity: 77n });
    }
  });

  it("uses SDK completion instead of local UDT, fee, and DAO steps", async () => {
    const calls: string[] = [];
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockImplementation(() => {
        calls.push("fee");
        return Promise.resolve([0, false]);
      });
    const daoLimit = vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockImplementation(() => {
      calls.push("dao-limit");
      return Promise.resolve(false);
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
    expect(daoLimit).not.toHaveBeenCalled();
    expect(calls).toEqual(["sdk-complete"]);
  });

  it("surfaces planner and completion failures as TxInfo errors", async () => {
    const plannerFailure = walletConfigWith({
      sdk: {
        buildConversionTransaction: vi
          .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
          .mockRejectedValue(new Error("planner failed")),
      },
    });
    await expect(buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, plannerFailure))
      .resolves.toMatchObject({ error: "planner failed" });

    const completionFailure = walletConfigWith({
      sdk: {
        completeTransaction: vi
          .fn<WalletConfig["sdk"]["completeTransaction"]>()
          .mockRejectedValue(new Error("completion failed")),
      },
    });
    await expect(buildTransactionPreview(context({ ckbAvailable: 1n }), true, 1n, completionFailure))
      .resolves.toMatchObject({ error: "completion failed" });
  });
});
