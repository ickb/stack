import { ccc } from "@ckb-ccc/ccc";
import {
  buildConversionTransaction,
  Ratio,
  type ConversionTransactionResult,
  type State,
} from "@ickb/sdk";

import { byte32FromByte, headerLike, offlineTestnetClient, script } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import {
  submitPendingTransaction,
  type PendingTransactionStore,
} from "../../../src/action/pendingTransaction.ts";
import type { buildTransactionPreview } from "../../../src/action/transaction.ts";
import type { SendableTx } from "../../../src/shared/utils.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<typeof buildConversionTransaction>
>;
type SuccessfulPlan = Extract<ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ConversionTransactionResult, { ok: false }>;

/**
 * A wallet config, with the SDK's build scripted as `buildConversionTransaction` (by
 * default a success): the calling test file mocks it in `@ickb/sdk`.
 */
export function walletConfigWith(
  overrides: { buildConversionTransaction?: typeof buildConversionTransaction } = {},
): Parameters<typeof buildTransactionPreview>[3] {
  vi.mocked(buildConversionTransaction).mockImplementation(
    overrides.buildConversionTransaction ??
      (async (): Promise<ConversionTransactionResult> => {
        await Promise.resolve();
        return successfulPlan({ tx: ccc.Transaction.default() });
      }),
  );
  const cccClient = offlineTestnetClient();
  return {
    chain: "testnet",
    cccClient,
    resetClient: vi.fn<() => void>(),
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
  };
}

export function buildConversionTransactionMock(
  result?: ConversionTransactionResult,
): BuildConversionTransactionMock {
  return vi
    .fn<typeof buildConversionTransaction>()
    .mockResolvedValue(result ?? successfulPlan());
}

export function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    plannedFee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
    ...overrides,
  };
}

export function failedPlan(reason: "insufficient-ckb" | "insufficient-ickb"): FailedPlan {
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
    plannedFee: 1n,
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

export function state(overrides: Partial<State> = {}): State {
  return {
    tip: headerLike({ timestamp: 0n }),
    feeRate: 1n,
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    // A cap's 100,000 iCKB at one to one.
    depositCapacity: ccc.fixedPointFrom(100_000),
    orderBook: [],
    poolDeposits: [],
    // The wallet preset's values: the SDK keeps its policies internal.
    lockUp: {
      minLockUp: ccc.Epoch.from([0n, 1n, 2n]),
      maxLockUp: ccc.Epoch.from([42n, 0n, 1n]),
      broadcastReserve: ccc.Epoch.from([0n, 3n, 8n]),
    },
    changeLock: script("11"),
    cells: [],
    receipts: [],
    readyWithdrawals: [],
    pendingWithdrawals: [],
    availableOrders: [],
    pendingOrders: [],
    hasCollectable: false,
    ckbNative: 0n,
    ickbNative: 0n,
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    ckbConvertible: 0n,
    ckbBalance: 0n,
    ickbBalance: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function testSigner(client: ccc.Client): ccc.Signer {
  return new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
}

/** Records `txHash` as the store's pending transaction through a send that succeeds. */
export async function recordPending(
  store: PendingTransactionStore,
  txHash: ccc.Hex,
): Promise<void> {
  await submitPendingTransaction(store, async () => {
    await Promise.resolve();
    return { ok: true, txHash };
  });
}
