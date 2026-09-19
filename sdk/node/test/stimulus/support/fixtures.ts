import { ccc } from "@ckb-ccc/core";
import {
  committedTransactionResponse,
  headerLike,
  pagedCells,
  script,
  StubClient,
} from "@ickb/testkit";
import { getConfig } from "../../../../src/constants.ts";
import type { SystemState } from "../../../../src/conversion/types.ts";
import type { ReceiptCell } from "../../../../src/logic.ts";
import { MasterCell, OrderCell, type OrderGroup } from "../../../../src/order/cells.ts";
import { OrderData } from "../../../../src/order/order_data.ts";
import { Ratio } from "../../../../src/order/ratio.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { encodeReceiptData } from "../../../../src/udt.ts";
import type { ExchangeRatio } from "../../../../src/utils/utils.ts";
import type { Runtime, StimulusState } from "../../../src/stimulus/state.ts";

export const CKB = ccc.fixedPointFrom(1);
export const PRIMARY_LOCK = script("11");

export function systemState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 42n,
    tip: headerLike({ number: 1_000_000n }),
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    orderPool: [],
    poolDeposits: [],
    ...overrides,
  };
}

export function accountState(
  overrides: Partial<StimulusState["account"]> = {},
): StimulusState["account"] {
  return {
    capacityCells: [],
    nativeUdtCells: [],
    receipts: [],
    withdrawalGroups: [],
    ...overrides,
  };
}

/** A real iCKB receipt worth `ckbValue` CKB and `udtValue` iCKB, one deposit of that amount. */
export function receipt(
  txHashByte: string,
  ckbValue: bigint,
  udtValue: bigint,
): ReceiptCell {
  const txHash: ccc.Hex = `0x${txHashByte.repeat(32)}`;
  const cell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: {
      capacity: ckbValue,
      lock: PRIMARY_LOCK,
      type: getConfig("testnet").ickbLogic.script,
    },
    outputData: ccc.hexFrom(
      encodeReceiptData({ depositQuantity: 1n, depositAmount: udtValue }),
    ),
  });
  return {
    cell,
    ckbValue,
    udtValue,
    header: { header: headerLike({ number: 1n }), txHash },
  };
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
  order = getConfig("testnet").order,
}: {
  system?: SystemState;
  account?: StimulusState["account"];
  orders?: OrderGroup[];
  originBlocks?: Map<ccc.Hex, bigint | undefined>;
  sdk?: Partial<Runtime["sdk"]>;
  order?: Runtime["order"];
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
    sdk: Object.assign(sdkOf(getConfig("testnet")), {
      getL1AccountState: async (): ReturnType<Runtime["sdk"]["getL1AccountState"]> => {
        await Promise.resolve();
        return { system, user: { orders }, account };
      },
      ...sdk,
    }),
    order,
    primaryLock: PRIMARY_LOCK,
    accountLocks: [PRIMARY_LOCK],
  };
}

const TWO_CKB_PER_UDT: ExchangeRatio = { ckbScale: 1n, udtScale: 2n };

/**
 * A resolver-produced order group under the testnet order scripts, so the real SDK melts
 * it; matchable orders carry 100 CKB and, by default, a buy price well above par.
 */
export async function order(
  txHashByte: string,
  isMatchable: boolean,
  ckbToUdt: ExchangeRatio = TWO_CKB_PER_UDT,
): Promise<OrderGroup> {
  const txHash: ccc.Hex = `0x${txHashByte.repeat(32)}`;
  const manager = getConfig("testnet").order;
  const { udtScript, script: orderLock } = manager;
  const ckbValue = isMatchable ? 100n * CKB : 0n;
  const master = new MasterCell(
    ccc.Cell.from({
      outPoint: { txHash, index: 1n },
      cellOutput: { lock: orderLock, type: orderLock },
      outputData: "0x",
    }),
  );
  const outputData = OrderData.from({
    udtValue: 0n,
    master: { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info: {
      ckbToUdt: Ratio.from(ckbToUdt),
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
    findCellsPagedNoCache: pagedCells((query) =>
      query.scriptType === "lock" ? [orderCell.cell] : [master.cell],
    ),
    getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return committedTransactionResponse(transaction);
    },
  });
  const groups = await manager.findOrders(client);
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}

/** The SDK over one config's manager instances, so spies on those managers see the actor's calls. */
function sdkOf(config: ReturnType<typeof getConfig>): IckbSdk {
  return new IckbSdk(config);
}
