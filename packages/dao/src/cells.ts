import { ccc, mol } from "@ckb-ccc/core";
import type { TransactionHeader, ValueComponents } from "@ickb/utils";

/**
 * Common decoded state for a DAO deposit or withdrawal request cell.
 *
 * @public
 */
export interface DaoCellBase extends ValueComponents {
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

  /** The DAO claim epoch for this cell, rolled to a later cycle when needed for deposit readiness. */
  maturity: ccc.Epoch;

  /**
   * Indicates whether this decoded cell is ready for the next transaction step.
   *
   * @remarks
   * Deposits use the DAO claim epoch from the deposit and tip headers, rolling
   * it forward by one DAO cycle when it is at or before `tip + minLockUp`, then
   * requiring the result to stay before `tip + maxLockUp`. Withdrawal requests
   * are ready when their maturity is at or before the tip epoch.
   */
  isReady: boolean;
}

/**
 * Represents a live Nervos DAO deposit cell.
 *
 * @public
 */
export interface DaoDepositCell extends DaoCellBase {
  /** Discriminates this decoded DAO cell as a deposit. */
  readonly isDeposit: true;
}

/**
 * Represents a live Nervos DAO withdrawal request cell.
 *
 * @public
 */
export interface DaoWithdrawalRequestCell extends DaoCellBase {
  /** Discriminates this decoded DAO cell as a withdrawal request. */
  readonly isDeposit: false;
}

/**
 * The default minimum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [0n, 1n, 24n]:
 * - 0 whole epochs,
 * - plus 1/24 of an epoch.
 *
 * On the target chain's nominal epoch cadence, 1/24 of an epoch is about 10 minutes.
 */
const defaultMinLockUp = ccc.Epoch.from([0n, 1n, 24n]); // 10 minutes

/**
 * The default maximum lock-up period represented as an Epoch.
 *
 * Calculated from the tuple [18n, 0n, 1n]:
 * - 18 whole epochs,
 * - plus 0/1 of an additional epoch.
 *
 * On the target chain's nominal epoch cadence, 18 epochs is about 3 days.
 */
const defaultMaxLockUp = ccc.Epoch.from([18n, 0n, 1n]); // 3 days

/**
 * Result shape returned by `ccc.Client.getTransactionWithHeader`.
 *
 * @public
 */
export type TransactionWithHeader = Awaited<
  ReturnType<ccc.Client["getTransactionWithHeader"]>
>;

/**
 * Batch-scoped caches for DAO cell conversion reads.
 *
 * @public
 */
export interface DaoCellFromCache {
  /** Reuses block-header reads by block number across DAO cell conversions in one batch. */
  headerCache?: Map<ccc.Num, Promise<ccc.ClientBlockHeader | undefined>>;
  /** Reuses transaction-with-header reads by transaction hash across DAO cell conversions in one batch. */
  transactionCache?: Map<ccc.Hex, Promise<TransactionWithHeader>>;
}

type DaoCell = DaoDepositCell | DaoWithdrawalRequestCell;

/**
 * Options required to decode a DAO cell and calculate readiness.
 *
 * @public
 */
export type DaoCellFromOptions = {
  /** Client used for transaction and header lookups. */
  client: ccc.Client;

  /** Tip header used as the readiness freshness anchor. */
  tip: ccc.ClientBlockHeader;

  /** Optional lower bound for deposit renewal readiness. */
  minLockUp?: ccc.Epoch;

  /** Optional upper bound for deposit renewal readiness. */
  maxLockUp?: ccc.Epoch;
} & DaoCellFromCache;

/**
 * Decodes a DAO deposit cell using the current tip as the newest header.
 *
 * @remarks Cache maps are scoped to one coherent conversion batch; callers should create a new batch for a freshness boundary.
 */
export function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: true },
): Promise<DaoDepositCell>;

/**
 * Decodes a DAO withdrawal request cell using its withdrawal transaction header as the newest header.
 *
 * @remarks Cache maps are scoped to one coherent conversion batch; callers should create a new batch for a freshness boundary.
 */
export function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: false },
): Promise<DaoWithdrawalRequestCell>;

export async function daoCellFrom(
  cell: ccc.Cell,
  options: DaoCellFromOptions & { isDeposit: boolean },
): Promise<DaoCell> {
  const headers = options.isDeposit
    ? await depositHeaders(cell, options)
    : await withdrawalRequestHeaders(cell, options);
  const [oldest, newest] = headers;

  const interests = ccc.calcDaoProfit(cell.capacityFree, oldest.header, newest.header);
  let maturity = ccc.calcDaoClaimEpoch(oldest.header, newest.header);

  const minLockUp = options.minLockUp ?? defaultMinLockUp;
  const maxLockUp = options.maxLockUp ?? defaultMaxLockUp;
  const readiness = daoCellReadiness({
    isDeposit: options.isDeposit,
    maturity,
    tip: options.tip,
    minLockUp,
    maxLockUp,
  });
  maturity = readiness.maturity;

  const ckbValue = cell.cellOutput.capacity + interests;
  const udtValue = 0n;

  const common = {
    cell,
    headers: [oldest, newest],
    interests,
    maturity,
    isReady: readiness.isReady,
    ckbValue,
    udtValue,
  } satisfies DaoCellBase;

  return options.isDeposit
    ? { ...common, isDeposit: true }
    : { ...common, isDeposit: false };
}

async function depositHeaders(
  cell: ccc.Cell,
  options: DaoCellFromOptions,
): Promise<[TransactionHeader, TransactionHeader]> {
  const txHash = cell.outPoint.txHash;
  let txWithHeader: Awaited<ReturnType<typeof getCachedTransactionWithHeader>>;
  try {
    txWithHeader = await getCachedTransactionWithHeader(options, txHash);
  } catch (error) {
    throw new Error(
      `Failed to load transaction header for txHash ${txHash} at ${cell.outPoint.toHex()}`,
      { cause: error },
    );
  }
  if (txWithHeader?.header === undefined) {
    throw new Error(`Header not found for txHash ${txHash} at ${cell.outPoint.toHex()}`);
  }
  return [{ header: txWithHeader.header, txHash }, { header: options.tip }];
}

async function withdrawalRequestHeaders(
  cell: ccc.Cell,
  options: DaoCellFromOptions,
): Promise<[TransactionHeader, TransactionHeader]> {
  const txHash = cell.outPoint.txHash;
  let depositBlockNumber: ccc.Num;
  try {
    depositBlockNumber = mol.Uint64LE.decode(cell.outputData);
  } catch (error) {
    throw new Error(
      `Invalid DAO withdrawal request payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
      { cause: error },
    );
  }
  const depositHeaderPromise = getWithdrawalDepositHeader(
    cell,
    options,
    depositBlockNumber,
  );
  const txWithHeaderPromise = getWithdrawalTransactionWithHeader(cell, options, txHash);
  const [depositHeader, txWithHeader] = await Promise.all([
    depositHeaderPromise,
    txWithHeaderPromise,
  ]);
  if (depositHeader === undefined) {
    throw new Error(
      `Header not found for block number ${String(depositBlockNumber)} at ${cell.outPoint.toHex()}`,
    );
  }
  if (txWithHeader?.header === undefined) {
    throw new Error(`Header not found for txHash ${txHash} at ${cell.outPoint.toHex()}`);
  }
  return [{ header: depositHeader }, { header: txWithHeader.header, txHash }];
}

async function getWithdrawalDepositHeader(
  cell: ccc.Cell,
  options: DaoCellFromOptions,
  depositBlockNumber: ccc.Num,
): Promise<ccc.ClientBlockHeader | undefined> {
  try {
    return await getCachedHeaderByNumber(options, depositBlockNumber);
  } catch (error) {
    throw new Error(
      `Failed to load header for block number ${String(depositBlockNumber)} at ${cell.outPoint.toHex()}`,
      { cause: error },
    );
  }
}

async function getWithdrawalTransactionWithHeader(
  cell: ccc.Cell,
  options: DaoCellFromOptions,
  txHash: ccc.Hex,
): Promise<TransactionWithHeader> {
  try {
    return await getCachedTransactionWithHeader(options, txHash);
  } catch (error) {
    throw new Error(
      `Failed to load transaction header for txHash ${txHash} at ${cell.outPoint.toHex()}`,
      { cause: error },
    );
  }
}

interface DaoCellReadinessOptions {
  isDeposit: boolean;
  maturity: ccc.Epoch;
  tip: ccc.ClientBlockHeader;
  minLockUp: ccc.Epoch;
  maxLockUp: ccc.Epoch;
}

function daoCellReadiness(options: DaoCellReadinessOptions): {
  isReady: boolean;
  maturity: ccc.Epoch;
} {
  if (!options.isDeposit) {
    return {
      maturity: options.maturity,
      isReady: options.maturity.compare(options.tip.epoch) <= 0,
    };
  }

  let maturity = options.maturity;
  if (maturity.compare(options.minLockUp.add(options.tip.epoch)) <= 0) {
    maturity = maturity.add([180n, 0n, 1n]);
  }
  return {
    maturity,
    isReady: options.maxLockUp.add(options.tip.epoch).compare(maturity) > 0,
  };
}

async function getCachedHeaderByNumber(
  options: DaoCellFromOptions,
  blockNumber: ccc.Num,
): Promise<ccc.ClientBlockHeader | undefined> {
  let promise = options.headerCache?.get(blockNumber);
  if (promise === undefined) {
    promise = options.client.getHeaderByNumber(blockNumber);
    options.headerCache?.set(blockNumber, promise);
  }
  return promise;
}

async function getCachedTransactionWithHeader(
  options: DaoCellFromOptions,
  txHash: ccc.Hex,
): Promise<TransactionWithHeader> {
  let promise = options.transactionCache?.get(txHash);
  if (promise === undefined) {
    promise = options.client.getTransactionWithHeader(txHash);
    options.transactionCache?.set(txHash, promise);
  }
  return promise;
}
