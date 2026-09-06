import { ccc } from "@ckb-ccc/core";
import { getConfig, IckbSdk, Ratio } from "@ickb/sdk";

import type { Runtime, TesterState } from "../../../../src/tester/runtime/runtime.ts";

export function runtimeDefaultSdk(): Runtime["sdk"] {
  const system = defaultSystemState();
  const account = emptyAccountState();
  return Object.assign(IckbSdk.fromConfig(getConfig("testnet")), {
    getL1AccountState: async (): ReturnType<Runtime["sdk"]["getL1AccountState"]> => {
      await Promise.resolve();
      return {
        system,
        user: { orders: [] },
        account,
      };
    },
    buildBaseTransaction: (txLike: ccc.TransactionLike) => ccc.Transaction.from(txLike),
    request: async (txLike: ccc.TransactionLike) => recordTxStep("request", [], txLike),
    completeTransaction: async (txLike: ccc.TransactionLike) =>
      recordTxStep("complete", [], txLike),
    buildConversionTransaction: async (
      txLike: ccc.TransactionLike,
    ): ReturnType<Runtime["sdk"]["buildConversionTransaction"]> => {
      await Promise.resolve();
      return {
        ok: true,
        tx: ccc.Transaction.from(txLike),
        estimatedMaturity: 0n,
        conversion: { kind: "order" },
      };
    },
  });
}

function defaultSystemState(): TesterState["system"] {
  return {
    feeRate: 42n,
    tip: ccc.ClientBlockHeader.from({
      compactTarget: 0n,
      dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
      epoch: [0n, 0n, 1n],
      extraHash: `0x${"bb".repeat(32)}`,
      hash: `0x${"cc".repeat(32)}`,
      nonce: 0n,
      number: 0n,
      parentHash: `0x${"dd".repeat(32)}`,
      proposalsHash: `0x${"ee".repeat(32)}`,
      timestamp: 0n,
      transactionsRoot: `0x${"ff".repeat(32)}`,
      version: 0n,
    }),
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    poolDeposits: { deposits: [], id: "default-pool-fixture" },
  };
}

function emptyAccountState(): TesterState["account"] {
  return {
    capacityCells: [],
    nativeUdtCells: [],
    nativeUdtCapacity: 0n,
    nativeUdtBalance: 0n,
    receipts: [],
    withdrawalGroups: [],
  };
}

async function recordTxStep(
  label: string,
  calls: string[],
  txLike: ccc.TransactionLike,
): Promise<ccc.Transaction> {
  calls.push(label);
  await Promise.resolve();
  return ccc.Transaction.from(txLike);
}
