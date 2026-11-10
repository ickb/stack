import { ccc } from "@ckb-ccc/core";
import {
  capacityCell,
  committedTransactionResponse,
  FRESH_BLOCK,
  headerLike,
  script,
  StubClient,
  type StubCell,
} from "@ickb/testkit";
import { ICKB_LOGIC, ICKB_UDT, ORDER } from "../../../../src/constants.ts";
import type { AccountState, SystemState } from "../../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../../src/dao.ts";
import { encodeReceiptData, type ReceiptCell } from "../../../../src/logic.ts";
import { MasterCell, OrderCell, type OrderGroup } from "../../../../src/order/cells.ts";
import { findOrders } from "../../../../src/order/order.ts";
import { OrderData } from "../../../../src/order/order_data.ts";
import { Ratio } from "../../../../src/order/ratio.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";
import type { ExchangeRatio } from "../../../../src/utils/utils.ts";
import type { Runtime } from "../../../src/stimulus/state.ts";

export const CKB = ccc.fixedPointFrom(1);
export const PRIMARY_LOCK = script("11");

export function systemState(overrides: Partial<SystemState> = {}): SystemState {
  const exchangeRatio =
    overrides.exchangeRatio ?? Ratio.from({ ckbScale: 1n, udtScale: 1n });
  return {
    feeRate: 42n,
    tip: headerLike({ number: 1_000_000n }),
    exchangeRatio,
    depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
    orderPool: [],
    poolDeposits: [],
    lockUp: WALLET_LOCK_UP,
    ...overrides,
  };
}

export function accountState(overrides: Partial<AccountState> = {}): AccountState {
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
      type: ICKB_LOGIC,
    },
    outputData: ccc.hexFrom(
      encodeReceiptData({ depositQuantity: 1n, depositAmount: udtValue }),
    ),
  });
  return {
    cell,
    ckbValue,
    udtValue,
    header: headerLike({ number: 1n }),
  };
}

export function plainCell(capacity: bigint, txHashByte: string): ccc.Cell {
  return capacityCell(capacity, PRIMARY_LOCK, txHashByte);
}

/**
 * Builds a runtime over the real testnet SDK with the L1 read, transaction builders, and
 * origin lookups replaced by the supplied stubs.
 */
export function runtime({
  system = systemState(),
  account = accountState(),
  orders = [],
  sdk = {},
}: {
  system?: SystemState;
  account?: AccountState;
  orders?: OrderGroup[];
  sdk?: Partial<Runtime["sdk"]>;
} = {}): Runtime {
  const client = new StubClient();
  const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
  return {
    client,
    signer,
    sdk: Object.assign(new IckbSdk(), {
      getL1AccountState: async (): ReturnType<Runtime["sdk"]["getL1AccountState"]> => {
        await Promise.resolve();
        return { system, userOrders: orders, account };
      },
      ...sdk,
    }),
    primaryLock: PRIMARY_LOCK,
    accountLocks: [PRIMARY_LOCK],
  };
}

const TWO_CKB_PER_UDT: ExchangeRatio = { ckbScale: 1n, udtScale: 2n };

/**
 * A resolver-produced order group under the testnet order scripts, so the real SDK melts
 * it; matchable orders carry 100 CKB and, by default, a buy price well above par.
 */
/** An order group as the scan resolves it; `blockNumber` dates its master and origin, fresh when omitted. */
export async function order(
  txHashByte: string,
  isMatchable: boolean,
  ckbToUdt: ExchangeRatio = TWO_CKB_PER_UDT,
  blockNumber?: bigint,
): Promise<OrderGroup> {
  const txHash: ccc.Hex = `0x${txHashByte.repeat(32)}`;
  const ckbValue = isMatchable ? 100n * CKB : 0n;
  const master = new MasterCell(
    ccc.Cell.from({
      outPoint: { txHash, index: 1n },
      cellOutput: { lock: ORDER, type: ORDER },
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
    cellOutput: { lock: ORDER, type: ICKB_UDT },
    outputData,
  });
  const orderCell = OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + ckbValue,
        lock: ORDER,
        type: ICKB_UDT,
      },
      outputData,
    }),
    FRESH_BLOCK,
  );
  const transaction = ccc.Transaction.default();
  transaction.outputs.push(orderCell.cell.cellOutput, master.cell.cellOutput);
  transaction.outputsData.push(orderCell.cell.outputData, master.cell.outputData);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    cells: (query): readonly StubCell[] => [
      // The order and its master share the mint's block.
      {
        cell: query.script_type === "lock" ? orderCell.cell : master.cell,
        blockNumber: blockNumber ?? FRESH_BLOCK,
      },
    ],
    getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return committedTransactionResponse(transaction);
    },
  });
  const groups = await findOrders(client);
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}
