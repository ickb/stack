import type * as IckbSdkModule from "@ickb/sdk";
import {
  TransactionBroadcastError,
  TransactionWaitError,
  signAndSendTransaction,
  waitTransaction,
} from "@ickb/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(import("@ickb/sdk"), async (importOriginal) => {
  const actual = await importOriginal<typeof IckbSdkModule>();
  return {
    ...actual,
    signAndSendTransaction: vi.fn(),
    waitTransaction: vi.fn(),
  };
});

import type { ExecutionLog } from "../../../../src/tester/runtime/testerTypes.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  buildBaseTransactionMock,
  byte32FromByte,
  capacityCell,
  ccc,
  completeTransactionMock,
  requestMock,
  runTesterAttempt,
  runtimeWithSdk,
  script,
  systemState,
} from "./support.ts";

const waitTransactionMock = vi.mocked(waitTransaction);
const signAndSendTransactionMock = vi.mocked(signAndSendTransaction);
const FETCH_FAILED = "fetch failed";

beforeEach(() => {
  signAndSendTransactionMock.mockReset();
  signAndSendTransactionMock.mockImplementation(async (signer, tx, recordTxHash) => {
    const txHash = await signer.sendTransaction(tx);
    recordTxHash?.(txHash);
    return txHash;
  });
  waitTransactionMock.mockReset();
});

describe("runTesterAttempt send outcomes", () => {
  it("sends a planned transaction and records on-sent evidence", async () => {
    const { calls, runtime } = fundedSendRuntime();
    const txHash = byte32FromByte("46");
    const sendTransaction = vi
      .spyOn(runtime.signer, "sendTransaction")
      .mockResolvedValue(txHash);
    waitTransactionMock.mockResolvedValueOnce(committedResponse());
    const executionLog: ExecutionLog = {};

    await runTesterAttempt({
      runtime,
      testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
      feePolicy: { fee: 1n, feeBase: 100000n },
      executionLog,
    });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(waitTransactionMock).toHaveBeenCalledWith(runtime.client, txHash, {
      timeout: 600_000,
    });
    expect(executionLog.actions).toMatchObject({
      testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    });
    expect(executionLog.txHash).toBe(txHash);
    expect(calls).toEqual(["base", "request", "complete"]);
  });
});

describe("runTesterAttempt wait failures", () => {
  it("ends one finite confirmation window as unresolved without resending", async () => {
    const { calls, runtime } = fundedSendRuntime();
    const txHash = byte32FromByte("47");
    vi.spyOn(runtime.signer, "sendTransaction").mockResolvedValue(txHash);
    const timeout = new ccc.ErrorClientWaitTransactionTimeout(600_000);
    waitTransactionMock.mockRejectedValue(timeout);
    const executionLog: ExecutionLog = {};

    await expect(runFundedSendAttempt(runtime, executionLog)).rejects.toMatchObject({
      name: "TransactionConfirmationError",
      txHash,
      status: "sent",
      isTimeout: true,
      cause: timeout,
    });

    expect(signAndSendTransactionMock).toHaveBeenCalledTimes(1);
    expect(waitTransactionMock).toHaveBeenCalledTimes(1);
    expect(waitTransactionMock.mock.calls[0]).toEqual([
      runtime.client,
      txHash,
      { timeout: 600_000 },
    ]);
    expect(calls).toEqual(["base", "request", "complete"]);
    expect(executionLog.txHash).toBe(txHash);
  });

  it("preserves terminal chain rejection evidence", async () => {
    const { runtime } = fundedSendRuntime();
    const txHash = byte32FromByte("48");
    vi.spyOn(runtime.signer, "sendTransaction").mockResolvedValue(txHash);
    waitTransactionMock.mockRejectedValueOnce(
      new TransactionWaitError(txHash, { status: "rejected", reason: "invalid" }),
    );

    await expect(runFundedSendAttempt(runtime, {})).rejects.toMatchObject({
      name: "TransactionConfirmationError",
      txHash,
      status: "rejected",
      reason: "invalid",
      isTimeout: false,
    });

    const withoutReason = fundedSendRuntime().runtime;
    const secondTxHash = byte32FromByte("4a");
    vi.spyOn(withoutReason.signer, "sendTransaction").mockResolvedValue(secondTxHash);
    waitTransactionMock.mockRejectedValueOnce(
      new TransactionWaitError(secondTxHash, { status: "rejected" }),
    );
    await expect(runFundedSendAttempt(withoutReason, {})).rejects.toMatchObject({
      txHash: secondTxHash,
      status: "rejected",
      reason: undefined,
      isTimeout: false,
    });
  });

  it("marks polling failures as unresolved after broadcast", async () => {
    const { runtime } = fundedSendRuntime();
    const txHash = byte32FromByte("49");
    const pollingError = new TypeError(FETCH_FAILED);
    vi.spyOn(runtime.signer, "sendTransaction").mockResolvedValue(txHash);
    waitTransactionMock.mockRejectedValueOnce(pollingError);

    const error = await rejectionFrom(runFundedSendAttempt(runtime, {}));
    expect(error).toMatchObject({
      name: "TransactionConfirmationError",
      message: "Transaction status remained unresolved",
      txHash,
      status: "sent",
      isTimeout: true,
      cause: pollingError,
    });
  });
});

describe("runTesterAttempt send ambiguity", () => {
  it("confirms the recorded identity after an ambiguous send without resending", async () => {
    const { calls, runtime } = fundedSendRuntime();
    const txHash = byte32FromByte("4b");
    signAndSendTransactionMock.mockImplementationOnce(
      async (_signer, _tx, recordTxHash) => {
        await Promise.resolve();
        recordTxHash?.(txHash);
        throw new TransactionBroadcastError(txHash, {
          cause: new TypeError(FETCH_FAILED),
        });
      },
    );
    waitTransactionMock.mockResolvedValueOnce(committedResponse());
    const executionLog: ExecutionLog = {};

    await expect(runFundedSendAttempt(runtime, executionLog)).resolves.toBeUndefined();

    expect(signAndSendTransactionMock).toHaveBeenCalledTimes(1);
    expect(waitTransactionMock).toHaveBeenCalledTimes(1);
    expect(waitTransactionMock.mock.calls[0]).toEqual([
      runtime.client,
      txHash,
      { timeout: 600_000 },
    ]);
    expect(calls).toEqual(["base", "request", "complete"]);
    expect(executionLog.txHash).toBe(txHash);
  });

  it("rethrows a pre-broadcast failure without waiting for a confirmation", async () => {
    const { runtime } = fundedSendRuntime();
    const feeCeiling = new Error("fee rate above ceiling");
    signAndSendTransactionMock.mockRejectedValueOnce(feeCeiling);

    await expect(runFundedSendAttempt(runtime, {})).rejects.toBe(feeCeiling);

    expect(waitTransactionMock).not.toHaveBeenCalled();
  });
});

describe("runTesterAttempt reserve outcomes", () => {
  it("skips sends when the completed transaction would drain reserve", async () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "48");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(999), lock });
    const runtime = runtimeWithSdk({
      buildBaseTransaction: () => ccc.Transaction.default(),
      request: async () => {
        await Promise.resolve();
        return ccc.Transaction.default();
      },
      completeTransaction: async () => {
        await Promise.resolve();
        return tx;
      },
      getL1AccountState: async () => {
        await Promise.resolve();
        return {
          system: systemState(),
          user: { orders: [] },
          account: {
            capacityCells: [spent],
            nativeUdtCells: [
              ccc.Cell.from({
                outPoint: { txHash: byte32FromByte("34"), index: 0n },
                cellOutput: { capacity: 0n, lock },
                outputData: ccc.numLeToBytes(ccc.fixedPointFrom(2), 16),
              }),
            ],
            nativeUdtCapacity: 0n,
            nativeUdtBalance: ccc.fixedPointFrom(2),
            receipts: [],
            withdrawalGroups: [],
          },
        };
      },
    });
    runtime.primaryLock = lock;
    runtime.accountLocks = [lock];
    const executionLog: ExecutionLog = {};

    await runTesterAttempt({
      runtime,
      testerScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      feePolicy: { fee: 1n, feeBase: 100000n },
      executionLog,
    });
    expect(waitTransactionMock).not.toHaveBeenCalled();
    expect(executionLog.skip).toMatchObject({
      reason: "post-tx-ckb-reserve",
      testerScenario: ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
    });
  });
});

function fundedSendRuntime(): {
  calls: string[];
  runtime: ReturnType<typeof runtimeWithSdk>;
} {
  const calls: string[] = [];
  const lock = script("11");
  const runtime = runtimeWithSdk({
    buildBaseTransaction: buildBaseTransactionMock(calls),
    request: requestMock(calls),
    completeTransaction: completeTransactionMock(calls),
    getL1AccountState: async () => {
      await Promise.resolve();
      return {
        system: systemState(),
        user: { orders: [] },
        account: {
          capacityCells: [capacityCell(ccc.fixedPointFrom(4000), lock, "45")],
          nativeUdtCells: [],
          nativeUdtCapacity: 0n,
          nativeUdtBalance: 0n,
          receipts: [],
          withdrawalGroups: [],
        },
      };
    },
  });
  runtime.primaryLock = lock;
  runtime.accountLocks = [lock];
  return { calls, runtime };
}

async function runFundedSendAttempt(
  runtime: ReturnType<typeof runtimeWithSdk>,
  executionLog: ExecutionLog,
): ReturnType<typeof runTesterAttempt> {
  await Promise.resolve();
  return runTesterAttempt({
    runtime,
    testerScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    feePolicy: { fee: 1n, feeBase: 100000n },
    executionLog,
  });
}

function committedResponse(): ccc.ClientTransactionResponse {
  return new ccc.ClientTransactionResponse(
    ccc.Transaction.default(),
    "committed",
    undefined,
    byte32FromByte("4e"),
    10n,
  );
}

async function rejectionFrom(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}
