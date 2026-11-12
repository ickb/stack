import { ccc } from "@ckb-ccc/ccc";
import { ickb } from "@ickb/sdk";

import { byte32FromByte, headerLike, offlineTestnetClient, script } from "@ickb/testkit";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import {
  submitPendingTransaction,
  type PendingTransactionStore,
} from "../../../src/action/pendingTransaction.ts";
import type { buildTransactionPreview } from "../../../src/action/transaction.ts";
import type { SendableTx } from "../../../src/shared/utils.ts";
import { testSigner } from "../../app/fixtures/query.ts";

type BuildConversionTransactionMock = ReturnType<
  typeof vi.fn<typeof ickb.buildConversionTransaction>
>;
type SuccessfulPlan = Extract<ickb.ConversionTransactionResult, { ok: true }>;
type FailedPlan = Extract<ickb.ConversionTransactionResult, { ok: false }>;

/**
 * A wallet config, with the SDK's build scripted as `ickb.buildConversionTransaction` (by
 * default a success): the calling test file mocks it in `@ickb/sdk`.
 */
export function walletConfigWith(
  overrides: { buildConversionTransaction?: typeof ickb.buildConversionTransaction } = {},
): Parameters<typeof buildTransactionPreview>[3] {
  vi.mocked(ickb.buildConversionTransaction).mockImplementation(
    overrides.buildConversionTransaction ??
      (async (): Promise<ickb.ConversionTransactionResult> => {
        await Promise.resolve();
        return successfulPlan({ tx: ccc.Transaction.default() });
      }),
  );
  const cccClient = offlineTestnetClient();
  return {
    chain: "testnet",
    cccClient,
    queryClient: new QueryClient(),
    signer: testSigner(cccClient),
    address: "ckt1test",
  };
}

export function buildConversionTransactionMock(
  result?: ickb.ConversionTransactionResult,
): BuildConversionTransactionMock {
  return vi
    .fn<typeof ickb.buildConversionTransaction>()
    .mockResolvedValue(result ?? successfulPlan());
}

/** What an order's cells and its master take, as a 2,000 CKB order showed. */
export const ORDER_CELLS = ccc.fixedPointFrom(295);

export function successfulPlan(overrides: Partial<SuccessfulPlan> = {}): SuccessfulPlan {
  return {
    ok: true,
    tx: txWithInput("aa"),
    plannedFee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
    orderOccupiedCapacity: ORDER_CELLS,
    broadcastBefore: undefined,
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
    conversionKind: "direct-plus-order",
    orderOccupiedCapacity: ORDER_CELLS,
    broadcastBefore: undefined,
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

export function state(overrides: Partial<ickb.State> = {}): ickb.State {
  return {
    tip: headerLike({ timestamp: 0n }),
    feeRate: 1n,
    exchangeRatio: { ckbScale: 1n, udtScale: 1n },
    // A cap's 100,000 iCKB at one to one.
    depositCapacity: ccc.fixedPointFrom(100_000),
    orderBook: [],
    poolDeposits: [],
    // The wallet preset's values: the SDK keeps its policies internal.
    poolIckb: 0n,
    poolCkb: 0n,
    apyPercent: 0,
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
    ickbConvertible: 0n,
    ckbBalance: 0n,
    ickbBalance: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

/** The store's pending hash, if the record is a sent transaction's. */
export function pendingHash(store: PendingTransactionStore): ccc.Hex | undefined {
  return store.current?.status === "pending" ? store.current.txHash : undefined;
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
