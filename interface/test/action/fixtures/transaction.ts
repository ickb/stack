import { ccc } from "@ckb-ccc/ccc";
import {
  IckbSdk,
  Ratio,
  WALLET_LOCK_UP,
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
} from "@ickb/sdk";

import { byte32FromByte, headerLike, offlineTestnetClient, script } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import {
  submitPendingTransaction,
  type PendingTransactionStore,
} from "../../../src/action/pendingTransaction.ts";
import type { buildTransactionPreview } from "../../../src/action/transaction.ts";
import type { SendableTx, WalletConfig } from "../../../src/shared/utils.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<WalletConfig["sdk"]["buildConversionTransaction"]>
>;
type SuccessfulPlan = Extract<ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ConversionTransactionResult, { ok: false }>;

export function walletConfigWith(
  overrides: { sdk?: NonNullable<Parameters<typeof testSdk>[0]> } = {},
): Parameters<typeof buildTransactionPreview>[4] {
  const cccClient = offlineTestnetClient();
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
    accountLocks: [script("11")],
    primaryLock: script("11"),
    sdk: testSdk(overrides.sdk),
  };
}

export function buildConversionTransactionMock(
  result?: ConversionTransactionResult,
): BuildConversionTransactionMock {
  return vi
    .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
    .mockResolvedValue(result ?? successfulPlan());
}

export function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    plannedFee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
    isSweepComplete: true,
    ...overrides,
  };
}

export function failedPlan(
  reason: Exclude<ConversionTransactionFailureReason, "amount-too-small">,
): FailedPlan {
  return { ok: false, reason };
}

/** A completed conversion ready to sign, spending one input from `txHashByte`. */
export function activeTxInfo(
  txHashByte = "11",
  overrides: Partial<SendableTx> = {},
): SendableTx {
  return {
    ok: true,
    tx: txWithInput(txHashByte),
    fee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "direct",
    ...overrides,
  };
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

export function context(
  overrides: Partial<ConversionTransactionContext> = {},
): ConversionTransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: headerLike({ timestamp: 0n }),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      // A cap's 100,000 iCKB at one to one.
      depositCapacity: ccc.fixedPointFrom(100_000),
      orderPool: [],
      poolDeposits: [],
      lockUp: WALLET_LOCK_UP,
    },
    cells: [],
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function testSigner(client: ccc.Client): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

function testSdk(
  options: {
    buildConversionTransaction?: WalletConfig["sdk"]["buildConversionTransaction"];
  } = {},
): WalletConfig["sdk"] {
  const sdk = IckbSdk.fromChain("testnet");
  vi.spyOn(sdk, "buildConversionTransaction").mockImplementation(
    options.buildConversionTransaction ??
      vi
        .fn<WalletConfig["sdk"]["buildConversionTransaction"]>()
        .mockResolvedValue(successfulPlan({ tx: ccc.Transaction.default() })),
  );
  return sdk;
}

/** Records `txHash` as the store's pending transaction through a send that succeeds. */
export async function recordPending(
  store: PendingTransactionStore,
  txHash: ccc.Hex,
): Promise<void> {
  await submitPendingTransaction(store, async (recordTxHash) => {
    recordTxHash(txHash);
    await Promise.resolve();
    return txHash;
  });
}
