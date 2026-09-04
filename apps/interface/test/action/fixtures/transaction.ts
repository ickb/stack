import { ccc } from "@ckb-ccc/ccc";
import { Ratio } from "@ickb/order";
import {
  getConfig,
  IckbSdk,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
} from "@ickb/sdk";
import { byte32FromByte, headerLike } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type {
  buildTransactionPreview,
  TransactionContext,
} from "../../../src/action/transaction.ts";
import type { WalletConfig } from "../../../src/shared/utils.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>
>;
type CompleteTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["completeTransaction"]>
>;
type SuccessfulPlan = Extract<ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ConversionTransactionResult, { ok: false }>;

export function walletConfigWith(
  overrides: WalletConfigTestOverrides,
): Parameters<typeof buildTransactionPreview>[3] {
  const base = walletConfig();
  return walletConfig({
    sdk: new TestSdk({
      buildConversionTransaction:
        overrides.sdk?.buildConversionTransaction ??
        base.sdk.buildConversionTransaction.bind(base.sdk),
      completeTransaction:
        overrides.sdk?.completeTransaction ?? base.sdk.completeTransaction.bind(base.sdk),
    }),
  });
}

function walletConfig(
  overrides: Partial<Parameters<typeof buildTransactionPreview>[3]> = {},
): Parameters<typeof buildTransactionPreview>[3] {
  const cccClient = testClient();
  return {
    chain: "testnet",
    cccClient,
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [script("11")],
    primaryLock: script("11"),
    sdk: new TestSdk(),
    ...overrides,
  };
}

export function buildConversionTransactionMock(
  result?: ConversionTransactionResult,
): BuildConversionTransactionMock {
  return vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>().mockResolvedValue(
    result ?? {
      ok: true,
      tx: txWithInput("aa"),
      estimatedMaturity: 0n,
      conversion: { kind: "order" },
    },
  );
}

export function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    estimatedMaturity: 0n,
    conversion: { kind: "order" },
    ...overrides,
  };
}

export function completeTransactionMock(): CompleteTransactionMock {
  return vi
    .fn<WalletConfig["sdk"]["completeTransaction"]>()
    .mockImplementation(resolvedTx);
}

export function failedPlan(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity = 0n,
): FailedPlan {
  return { ok: false, reason, estimatedMaturity };
}

export function txWithInput(txHashByte: string): ccc.Transaction {
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

export function context(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: headerLike({ timestamp: 0n }),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      poolDeposits: { deposits: [], id: "" },
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

async function resolvedTx(txLike: ccc.TransactionLike): Promise<ccc.Transaction> {
  await Promise.resolve();
  return ccc.Transaction.from(txLike);
}

function testClient(): ccc.Client {
  return new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
}

function testSigner(client: ccc.Client): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

class TestSdk extends IckbSdk {
  public override buildConversionTransaction: WalletConfig["sdk"]["buildConversionTransaction"];
  public override completeTransaction: WalletConfig["sdk"]["completeTransaction"];

  constructor(
    options: {
      buildConversionTransaction?: WalletConfig["sdk"]["buildConversionTransaction"];
      completeTransaction?: WalletConfig["sdk"]["completeTransaction"];
    } = {},
  ) {
    const config = getConfig("testnet");
    super({
      ickbUdt: config.managers.ickbUdt,
      ownedOwner: config.managers.ownedOwner,
      ickbLogic: config.managers.logic,
      order: config.managers.order,
      bots: config.bots,
    });
    this.buildConversionTransaction =
      options.buildConversionTransaction ??
      vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>().mockResolvedValue({
        ok: true,
        tx: ccc.Transaction.default(),
        estimatedMaturity: 0n,
        conversion: { kind: "order" },
      });
    this.completeTransaction =
      options.completeTransaction ??
      (async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
  }
}

interface WalletConfigTestOverrides {
  sdk?: {
    buildConversionTransaction?: WalletConfig["sdk"]["buildConversionTransaction"];
    completeTransaction?: WalletConfig["sdk"]["completeTransaction"];
  };
}
