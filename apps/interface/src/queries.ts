import {
  projectAccountAvailability,
  type SystemState,
} from "@ickb/sdk";
import {
  buildTransactionPreview,
  type TransactionContext,
} from "./transaction.ts";
import { type TxInfo, type WalletConfig } from "./utils.ts";

interface StateValue {
  ckbValue: bigint;
  udtValue: bigint;
}
interface OutPointLike {
  toHex?: () => string;
  txHash?: unknown;
  index?: unknown;
}
interface CellLike {
  outPoint?: OutPointLike;
}
interface ReceiptState extends StateValue {
  cell?: CellLike;
}
interface WithdrawalState extends StateValue {
  owned?: { cell?: CellLike };
  owner?: { cell?: CellLike };
}
interface OrderState extends StateValue {
  cell?: CellLike;
  order?: { cell?: CellLike };
  master?: { cell?: CellLike };
  origin?: { cell?: CellLike };
}

export interface L1StateType {
  ckbNative: bigint;
  ickbNative: bigint;
  ckbBalance: bigint;
  ickbBalance: bigint;
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  tipTimestamp: bigint;
  system: SystemState;
  stateId: string;
  txBuilder: (isCkb2Udt: boolean, amount: bigint) => Promise<TxInfo>;
  hasMatchable: boolean;
}

export function l1StateQueryKey(
  walletConfig: WalletConfig,
): readonly [WalletConfig["chain"], string, string, "l1State"] {
  return [
    walletConfig.chain,
    walletConfig.address,
    walletLocksKey(walletConfig),
    "l1State",
  ] as const;
}

export function l1StateOptions(
  walletConfig: WalletConfig,
  isFrozen: boolean,
): {
  enabled: boolean;
  retry: number;
  refetchInterval: (context: { state: { data?: L1StateType } }) => number;
  staleTime: number;
  queryKey: readonly [WalletConfig["chain"], string, string, "l1State"];
  queryFn: () => Promise<L1StateType>;
} {
  return {
    enabled: !isFrozen,
    retry: 2,
    refetchInterval: ({ state }) => 60000 * (state.data?.hasMatchable ? 1 : 10),
    staleTime: 10000,
    queryKey: l1StateQueryKey(walletConfig),
    queryFn: async () => await getL1State(walletConfig),
  };
}

export async function getL1State(
  walletConfig: WalletConfig,
): Promise<L1StateType> {
  const sdkState = await walletConfig.sdk.getL1AccountState(
    walletConfig.cccClient,
    walletConfig.accountLocks,
  );
  const { system, user, account } = sdkState;
  const projection = projectAccountAvailability(account, user.orders, {
    collectedOrdersAvailable: true,
  });
  const hasMatchable = user.orders.some((group) => group.order.isMatchable());
  const {
    ckbNative,
    ickbNative,
    ckbBalance,
    ickbBalance,
    ckbAvailable,
    ickbAvailable,
    readyWithdrawals,
    pendingWithdrawals,
    availableOrders,
    pendingOrders,
  } = projection;

  const estimatedMaturity = [
    system.tip.timestamp,
    ...pendingWithdrawals.map((group) => group.owned.maturity.toUnix(system.tip)),
    ...pendingOrders
      .map((group) => group.order.maturity)
      .filter((maturity): maturity is bigint => maturity !== undefined),
  ].reduce((best, maturity) => (best > maturity ? best : maturity));

  const txContext: TransactionContext = {
    system,
    capacityCells: account.capacityCells,
    nativeUdtCells: account.nativeUdtCells,
    receipts: account.receipts,
    readyWithdrawals,
    availableOrders,
    ckbAvailable,
    ickbAvailable,
    estimatedMaturity,
  };

  return {
    ckbNative,
    ickbNative,
    ckbBalance,
    ickbBalance,
    ckbAvailable,
    ickbAvailable,
    tipTimestamp: system.tip.timestamp,
    system,
    stateId: buildStateId(walletConfig, txContext, pendingWithdrawals, pendingOrders),
    txBuilder: (isCkb2Udt, amount) =>
      buildTransactionPreview(txContext, isCkb2Udt, amount, walletConfig),
    hasMatchable,
  };
}

function buildStateId(
  walletConfig: WalletConfig,
  context: TransactionContext,
  pendingWithdrawals: readonly WithdrawalState[],
  pendingOrders: readonly OrderState[],
): string {
  const { system } = context;
  return [
    `chain=${walletConfig.chain}`,
    `locks=${walletLocksKey(walletConfig)}`,
    `tip=${tipKey(system.tip)}`,
    `fee=${String(system.feeRate)}`,
    `ratio=${String(system.exchangeRatio.ckbScale)}/${String(system.exchangeRatio.udtScale)}`,
    `pool=${String(system.ckbAvailable)};${system.ckbMaturing.map(maturingKey).join(",")};${orderCellsKey(system.orderPool)};deposits=${system.poolDeposits?.id ?? ""}`,
    `balances=${String(context.ckbAvailable)}/${String(context.ickbAvailable)}`,
    `capacityCells=${cellsKey(context.capacityCells)}`,
    `nativeUdtCells=${cellsKey(context.nativeUdtCells)}`,
    `maturity=${String(context.estimatedMaturity)}`,
    `receipts=${receiptsKey(context.receipts)}`,
    `readyWithdrawals=${withdrawalsKey(context.readyWithdrawals)}`,
    `availableOrders=${ordersKey(context.availableOrders)}`,
    `pendingWithdrawals=${withdrawalsKey(pendingWithdrawals)}`,
    `pendingOrders=${ordersKey(pendingOrders)}`,
  ].join("|");
}

function walletLocksKey(walletConfig: WalletConfig): string {
  return `primary=${walletConfig.primaryLock.toHex()};accounts=${scriptsKey(walletConfig.accountLocks)}`;
}

function scriptsKey(scripts: readonly { toHex: () => string }[]): string {
  return [...new Set(scripts.map((script) => script.toHex()))].sort().join(",");
}

function tipKey(tip: SystemState["tip"]): string {
  return `${primitiveKey(tip.hash, "tip.hash")}/${primitiveKey(tip.number, "tip.number")}/${primitiveKey(tip.timestamp, "tip.timestamp")}`;
}

function maturingKey(item: SystemState["ckbMaturing"][number]): string {
  return `${String(item.ckbCumulative)}@${String(item.maturity)}`;
}

function valueKey(item: StateValue): string {
  return `${String(item.ckbValue)}/${String(item.udtValue)}`;
}

function outPointKey(outPoint: OutPointLike | undefined): string {
  if (!outPoint) {
    return "missing-outpoint";
  }
  if (outPoint.toHex) {
    return outPoint.toHex();
  }
  return `${primitiveKey(outPoint.txHash, "outpoint.txHash")}#${primitiveKey(outPoint.index, "outpoint.index")}`;
}

function primitiveKey(value: unknown, label: string): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (value === undefined || value === null) {
    return `missing-${label}`;
  }

  return `invalid-${label}`;
}

function cellKey(cell: CellLike | undefined): string {
  return outPointKey(cell?.outPoint);
}

function receiptsKey(receipts: readonly ReceiptState[]): string {
  return receipts.map((receipt) => `${valueKey(receipt)}@${cellKey(receipt.cell)}`).join(",");
}

function cellsKey(cells: readonly CellLike[]): string {
  return cells.map(cellKey).join(",");
}

function withdrawalsKey(withdrawals: readonly WithdrawalState[]): string {
  return withdrawals
    .map((withdrawal) => [
      valueKey(withdrawal),
      cellKey(withdrawal.owned?.cell),
      cellKey(withdrawal.owner?.cell),
    ].join("@"))
    .join(",");
}

function orderCellsKey(orders: readonly OrderState[]): string {
  return orders.map((order) => `${valueKey(order)}@${cellKey(order.cell)}`).join(",");
}

function ordersKey(orders: readonly OrderState[]): string {
  return orders
    .map((order) => [
      valueKey(order),
      cellKey(order.order?.cell),
      cellKey(order.master?.cell),
      cellKey(order.origin?.cell),
    ].join("@"))
    .join(",");
}
