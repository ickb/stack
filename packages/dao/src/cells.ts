import { ccc, mol } from "@ckb-ccc/core";
import { type TransactionHeader, type ValueComponents } from "@ickb/utils";

interface DaoCellBase extends ValueComponents {
  /** The DAO cell. */
  cell: ccc.Cell;

  /**
   * The headers associated with the transaction.
   * In case of deposit, it contains [depositHeader, tipHeader],
   * while in case of withdrawal request, it contains [depositHeader, withdrawalRequestHeader].
   */
  headers: [TransactionHeader, TransactionHeader];

  /** The interests accrued on the DAO cell. */
  interests: ccc.Num;

  /** The maturity epoch of the DAO cell. In case of deposit, it's calculated from tip plus minLockUp. */
  maturity: ccc.Epoch;

  /**
   * Indicates the readiness to be consumed by a transaction.
   * In case of deposit, it is true only when the renewal stays strictly inside the configured window:
   * `tip + minLockUp < maturity < tip + maxLockUp`.
   * while in case of withdrawal request, it indicates the readiness for withdrawal.
   */
  isReady: boolean;
}

export interface DaoDepositCell extends DaoCellBase {
  readonly isDeposit: true;
}

export interface DaoWithdrawalRequestCell extends DaoCellBase {
  readonly isDeposit: false;
}

type DaoCell = DaoDepositCell | DaoWithdrawalRequestCell;

type DaoCellFromOptions = {
  client: ccc.Client;
  tip: ccc.ClientBlockHeader;
  minLockUp?: ccc.Epoch;
  maxLockUp?: ccc.Epoch;
};

export function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: true },
): Promise<DaoDepositCell>;

export function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: false },
): Promise<DaoWithdrawalRequestCell>;

export async function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: boolean },
): Promise<DaoCell> {
  const { isDeposit, tip } = options;
  const txHash = cell.outPoint.txHash;
  let oldest: TransactionHeader;
  let withdrawalTxWithHeader:
    | Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
    | undefined;
  if (!isDeposit) {
    const [header, txWithHeader] = await Promise.all([
      options.client.getHeaderByNumber(mol.Uint64LE.decode(cell.outputData)),
      options.client.getTransactionWithHeader(txHash),
    ]);
    if (!header) {
      throw new Error("Header not found for block number");
    }
    oldest = { header };
    withdrawalTxWithHeader = txWithHeader;
  } else {
    const txWithHeader =
      await options.client.getTransactionWithHeader(txHash);
    if (!txWithHeader?.header) {
      throw new Error("Header not found for txHash");
    }
    oldest = { header: txWithHeader.header, txHash };
  }

  let newest: TransactionHeader;
  if (!isDeposit) {
    const txWithHeader = withdrawalTxWithHeader;
    if (!txWithHeader?.header) {
      throw new Error("Header not found for txHash");
    }
    newest = { header: txWithHeader.header, txHash };
  } else {
    newest = { header: tip };
  }

  const interests = ccc.calcDaoProfit(
    cell.capacityFree,
    oldest.header,
    newest.header,
  );
  let maturity = ccc.calcDaoClaimEpoch(oldest.header, newest.header);

  const minLockUp = options.minLockUp ?? defaultMinLockUp;
  const maxLockUp = options.maxLockUp ?? defaultMaxLockUp;

  // Deposit: ready only within the current/next usable DAO window.
  // The boundaries are exclusive so callers do not race an exact-edge inclusion.
  // WithdrawalRequest: ready once the claim epoch has been reached.
  let isReady = isDeposit
    ? maturity.compare(minLockUp.add(tip.epoch)) > 0
    : maturity.compare(tip.epoch) <= 0;

  if (isDeposit) {
    // Deposit: maturity < tip.epoch + maxLockUp
    if (!isReady) {
      // This deposit is late for this cycle and it will be withdrawable in the next cycle
      maturity = maturity.add([180n, 0n, 1n]);
      // isReady = true; // Ready for next cycle
    }
    isReady = maxLockUp.add(tip.epoch).compare(maturity) > 0;
  }

  const ckbValue = cell.cellOutput.capacity + interests;
  const udtValue = 0n;

  const common = {
    cell,
    headers: [oldest, newest],
    interests,
    maturity,
    isReady,
    ckbValue,
    udtValue,
  } satisfies DaoCellBase;

  return isDeposit
    ? { ...common, isDeposit: true }
    : { ...common, isDeposit: false };
}

/**
 * The default minimum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [0n, 1n, 24n]:
 * - 0 whole epochs,
 * - plus 1/24 of an epoch.
 *
 * Given each epoch represents 4 hours (14400000 milliseconds),
 * then 1/24 of an epoch equals: (14400000 / 24) = 600000 milliseconds, i.e. 10 minutes.
 */
const defaultMinLockUp = ccc.Epoch.from([0n, 1n, 24n]); // 10 minutes

/**
 * The default maximum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [18n, 0n, 1n]:
 * - 18 whole epochs,
 * - plus 0/1 of an additional epoch.
 *
 * With each epoch lasting 4 hours, 18 epochs equal 18 * 4 hours = 72 hours,
 * i.e. 3 days.
 */
const defaultMaxLockUp = ccc.Epoch.from([18n, 0n, 1n]); // 3 days
