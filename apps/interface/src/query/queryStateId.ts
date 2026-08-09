import type { WalletConfig } from "../shared/utils.ts";

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
interface StateTip {
  hash?: unknown;
  number?: unknown;
  timestamp?: unknown;
}
interface MaturingState {
  ckbCumulative: bigint;
  maturity: bigint;
}
interface StateSystem {
  feeRate: bigint;
  tip: StateTip;
  exchangeRatio: { ckbScale: bigint; udtScale: bigint };
  orderPool: readonly OrderState[];
  poolDeposits: { id: string };
  ckbAvailable: bigint;
  ckbMaturing: readonly MaturingState[];
}
interface StateIdentityContext {
  system: StateSystem;
  capacityCells: readonly CellLike[];
  nativeUdtCells: readonly CellLike[];
  receipts: readonly ReceiptState[];
  readyWithdrawals: readonly WithdrawalState[];
  availableOrders: readonly OrderState[];
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  estimatedMaturity: bigint;
}

/**
 * Builds a deterministic identity for the wallet state used by transaction previews.
 *
 * @remarks The id covers chain, full account lock scripts, sampled tip, fee
 * rate, exchange ratio, public pool state, balances, input cells, collectable
 * objects, and pending objects. Missing outpoints are represented explicitly so
 * incomplete cache data cannot collapse into the same key as live cells.
 */
export function buildStateId(
  walletConfig: Pick<WalletConfig, "chain" | "accountLocks" | "primaryLock">,
  context: StateIdentityContext,
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
    `pool=${String(system.ckbAvailable)};${system.ckbMaturing.map(maturingKey).join(",")};${ordersKey(system.orderPool)};deposits=${system.poolDeposits.id}`,
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

/** Builds a stable key from the primary lock and full unique account lock scripts. */
export function walletLocksKey(
  walletConfig: Pick<WalletConfig, "accountLocks" | "primaryLock">,
): string {
  return `primary=${walletConfig.primaryLock.toHex()};accounts=${scriptsKey(walletConfig.accountLocks)}`;
}

function scriptsKey(scripts: ReadonlyArray<{ toHex: () => string }>): string {
  const uniqueScripts = [...new Set(scripts.map((script) => script.toHex()))];
  return uniqueScripts.toSorted((left, right) => left.localeCompare(right)).join(",");
}

function tipKey(tip: StateTip): string {
  return `${primitiveKey(tip.hash, "tip.hash")}/${primitiveKey(tip.number, "tip.number")}/${primitiveKey(tip.timestamp, "tip.timestamp")}`;
}

function maturingKey(item: MaturingState): string {
  return `${String(item.ckbCumulative)}@${String(item.maturity)}`;
}

function receiptsKey(receipts: readonly ReceiptState[]): string {
  return receipts
    .map((receipt) => `${valueKey(receipt)}@${cellKey(receipt.cell)}`)
    .join(",");
}

function cellsKey(cells: readonly CellLike[]): string {
  return cells.map(cellKey).join(",");
}

function withdrawalsKey(withdrawals: readonly WithdrawalState[]): string {
  return withdrawals
    .map((withdrawal) =>
      [
        valueKey(withdrawal),
        cellKey(withdrawal.owned?.cell),
        cellKey(withdrawal.owner?.cell),
      ].join("@"),
    )
    .join(",");
}

function ordersKey(orders: readonly OrderState[]): string {
  return orders
    .map((order) =>
      [
        valueKey(order),
        cellKey(order.order?.cell),
        cellKey(order.master?.cell),
        cellKey(order.origin?.cell),
      ].join("@"),
    )
    .join(",");
}

function valueKey(item: StateValue): string {
  return `${String(item.ckbValue)}/${String(item.udtValue)}`;
}

function cellKey(cell: CellLike | undefined): string {
  return outPointKey(cell?.outPoint);
}

function outPointKey(outPoint: OutPointLike | undefined): string {
  if (outPoint === undefined) {
    return "missing-outpoint";
  }
  if (outPoint.toHex !== undefined) {
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
