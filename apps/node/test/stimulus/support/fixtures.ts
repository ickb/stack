import { ccc } from "@ckb-ccc/core";
import {
  getConfig,
  IckbSdk,
  MasterCell,
  OrderCell,
  OrderData,
  type OrderGroup,
  Ratio,
  type ReceiptCell,
  type SystemState,
} from "@ickb/sdk";
import {
  committedTransactionResponse,
  headerLike,
  script,
  StubClient,
} from "@ickb/testkit";
import type { Runtime, StimulusState } from "../../../src/stimulus/state.ts";

export const CKB = ccc.fixedPointFrom(1);
export const PRIMARY_LOCK = script("11");

export function systemState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 42n,
    tip: headerLike({ number: 1_000_000n }),
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    poolDeposits: { deposits: [], id: "pool-fixture" },
    ...overrides,
  };
}

export function accountState(
  overrides: Partial<StimulusState["account"]> = {},
): StimulusState["account"] {
  return {
    capacityCells: [],
    nativeUdtCells: [],
    nativeUdtCapacity: 0n,
    nativeUdtBalance: 0n,
    receipts: [],
    withdrawalGroups: [],
    ...overrides,
  };
}

/** A receipt worth `ckbValue` CKB and `udtValue` iCKB; the turn only counts and collects it. */
export function receipt(
  txHashByte: string,
  ckbValue: bigint,
  udtValue: bigint,
): ReceiptCell {
  const cell = plainCell(ckbValue, txHashByte);
  return { cell, ckbValue, udtValue, header: { header: headerLike({ number: 1n }) } };
}

export function plainCell(capacity: bigint, txHashByte: string): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: `0x${txHashByte.repeat(32)}`, index: 0n },
    cellOutput: { capacity, lock: PRIMARY_LOCK },
    outputData: "0x",
  });
}

/**
 * Builds a runtime over the real testnet SDK with the L1 read, transaction builders, and
 * origin lookups replaced by the supplied stubs.
 */
export function runtime({
  system = systemState(),
  account = accountState(),
  orders = [],
  originBlocks = new Map<ccc.Hex, bigint | undefined>(),
  sdk = {},
}: {
  system?: SystemState;
  account?: StimulusState["account"];
  orders?: OrderGroup[];
  originBlocks?: Map<ccc.Hex, bigint | undefined>;
  sdk?: Partial<Runtime["sdk"]>;
} = {}): Runtime {
  const client = new StubClient({
    getTransaction: async (txHash): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      const blockNumber = originBlocks.get(ccc.hexFrom(txHash));
      return committedTransactionResponse(
        ccc.Transaction.default(),
        blockNumber === undefined ? {} : { blockNumber },
      );
    },
  });
  const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
  return {
    client,
    signer,
    sdk: Object.assign(IckbSdk.fromConfig(getConfig("testnet")), {
      getL1AccountState: async (): ReturnType<Runtime["sdk"]["getL1AccountState"]> => {
        await Promise.resolve();
        return { system, user: { orders }, account };
      },
      ...sdk,
    }),
    primaryLock: PRIMARY_LOCK,
    accountLocks: [PRIMARY_LOCK],
  };
}

/**
 * A resolver-produced order group under the testnet order scripts, so the real SDK melts
 * it; matchable orders carry 100 CKB.
 */
export async function order(
  txHashByte: string,
  isMatchable: boolean,
): Promise<OrderGroup> {
  const txHash: ccc.Hex = `0x${txHashByte.repeat(32)}`;
  const manager = getConfig("testnet").managers.order;
  const { udtScript, script: orderLock } = manager;
  const ckbValue = isMatchable ? 100n * CKB : 0n;
  const master = MasterCell.from({
    outPoint: { txHash, index: 1n },
    cellOutput: { lock: orderLock, type: orderLock },
    outputData: "0x",
  });
  const outputData = OrderData.from({
    udtValue: 0n,
    master: { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info: {
      ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 2n }),
      udtToCkb: Ratio.empty(),
      ckbMinMatchLog: 0,
    },
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: { lock: orderLock, type: udtScript },
    outputData,
  });
  const orderCell = OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + ckbValue,
        lock: orderLock,
        type: udtScript,
      },
      outputData,
    }),
  );
  const transaction = ccc.Transaction.default();
  transaction.outputs.push(orderCell.cell.cellOutput, master.cell.cellOutput);
  transaction.outputsData.push(orderCell.cell.outputData, master.cell.outputData);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
      await Promise.resolve();
      if (query.scriptType === "lock") {
        yield orderCell.cell;
      } else {
        yield master.cell;
      }
    },
    getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return committedTransactionResponse(transaction);
    },
  });
  const groups: OrderGroup[] = [];
  for await (const group of manager.findOrders(client)) {
    groups.push(group);
  }
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}
