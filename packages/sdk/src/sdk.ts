import { ccc } from "@ckb-ccc/core";
import { assertDaoOutputLimit, DaoOutputLimitError } from "@ickb/dao";
import {
  collect,
  collectCompleteScan,
  binarySearch,
  compareBigInt,
  defaultFindCellsLimit,
  isPlainCapacityCell,
  unique,
  type ValueComponents,
} from "@ickb/utils";
import {
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
  type IckbUdt,
  ickbExchangeRatio,
  type LogicManager,
  type OwnedOwnerManager,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import {
  Info,
  OrderCell,
  OrderGroup,
  OrderManager,
  Ratio,
} from "@ickb/order";
import { getConfig } from "./constants.js";
import {
  selectExactReadyWithdrawalDepositCandidates,
} from "./withdrawal_selection.js";

export const MAX_DIRECT_DEPOSITS = 60;
export const MAX_WITHDRAWAL_REQUESTS = 30;

const DAO_OUTPUT_LIMIT = 64;
const ORDER_MINT_OUTPUTS = 2;
const CONVERSION_MATURITY_BUCKET_MS = 60n * 60n * 1000n;

type SleepScheduler = (handler: () => void, timeout?: number) => unknown;

export type ConversionDirection = "ckb-to-ickb" | "ickb-to-ckb";

export interface PoolDepositState {
  deposits: IckbDepositCell[];
  readyDeposits: IckbDepositCell[];
  id: string;
}

export interface ConversionTransactionContext {
  system: SystemState;
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  availableOrders: OrderGroup[];
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  estimatedMaturity: bigint;
}

export interface ConversionTransactionOptions {
  direction: ConversionDirection;
  amount: bigint;
  lock: ccc.Script;
  context: ConversionTransactionContext;
  limits?: {
    maxDirectDeposits?: number;
    maxWithdrawalRequests?: number;
  };
}

export type ConversionTransactionFailureReason =
  | "amount-negative"
  | "insufficient-ckb"
  | "insufficient-ickb"
  | "amount-too-small"
  | "not-enough-ready-deposits"
  | "nothing-to-do";

export interface ConversionNotice {
  kind: "dust-ickb-to-ckb" | "maturity-unavailable";
  inputIckb: bigint;
  outputCkb: bigint;
  incentiveCkb: bigint;
  maturityEstimateUnavailable: boolean;
}

export interface ConversionMetadata {
  kind: "direct" | "order" | "direct-plus-order" | "collect-only";
}

export type ConversionTransactionResult =
  | {
      ok: true;
      tx: ccc.Transaction;
      estimatedMaturity: bigint;
      conversion: ConversionMetadata;
      conversionNotice?: ConversionNotice;
    }
  | {
      ok: false;
      reason: ConversionTransactionFailureReason;
      estimatedMaturity: bigint;
    };

export interface CompleteIckbTransactionOptions {
  signer: ccc.Signer;
  client: ccc.Client;
  feeRate: ccc.Num;
}

export interface SendAndWaitForCommitOptions {
  maxConfirmationChecks?: number;
  confirmationIntervalMs?: number;
  onSent?: (txHash: ccc.Hex) => void;
  onConfirmationWait?: () => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface GetL1StateOptions {
  orderLimit?: number;
  poolDepositLimit?: number;
}

export interface GetL1AccountStateOptions extends GetL1StateOptions {
  accountLimit?: number;
}

export interface IckbToCkbOrderEstimate {
  estimate: ReturnType<typeof IckbSdk.estimate>;
  maturity: bigint | undefined;
  notice?: ConversionNotice;
}

export class TransactionConfirmationError extends Error {
  constructor(
    message: string,
    public readonly txHash: ccc.Hex,
    public readonly status: string | undefined,
    public readonly isTimeout: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TransactionConfirmationError";
  }
}

type IckbUdtCompleter = Pick<IckbUdt, "completeBy" | "infoFrom" | "isUdt">;

/**
 * Completes a stack-built partial transaction with the iCKB post-processing
 * steps.
 *
 * The transaction completion boundary stays the same: callers still decide when
 * to finalize, but they no longer need to duplicate the required order.
 */
export async function completeIckbTransaction(
  txLike: ccc.TransactionLike,
  ickbUdt: IckbUdtCompleter,
  options: CompleteIckbTransactionOptions,
): Promise<ccc.Transaction> {
  const tx = await ickbUdt.completeBy(txLike, options.signer);
  await tx.completeFeeBy(options.signer, options.feeRate);
  await assertDaoOutputLimit(tx, options.client);
  return tx;
}

export async function sendAndWaitForCommit(
  { client, signer }: { client: ccc.Client; signer: ccc.Signer },
  tx: ccc.Transaction,
  {
    maxConfirmationChecks = 60,
    confirmationIntervalMs = 10_000,
    onSent,
    onConfirmationWait,
    sleep = delay,
  }: SendAndWaitForCommitOptions = {},
): Promise<ccc.Hex> {
  const txHash = await signer.sendTransaction(tx);
  onSent?.(txHash);
  let status: string | undefined = "sent";
  let lastPollingError: unknown;

  for (let checks = 0; checks < maxConfirmationChecks && isPendingStatus(status); checks += 1) {
    try {
      status = (await client.getTransaction(txHash))?.status;
    } catch (error) {
      // Post-broadcast polling errors are transient; keep waiting until timeout.
      lastPollingError = error;
    }
    if (!isPendingStatus(status)) {
      break;
    }

    onConfirmationWait?.();
    await sleep(confirmationIntervalMs);
  }

  if (status === "committed") {
    return txHash;
  }

  if (isPendingStatus(status)) {
    throw new TransactionConfirmationError(
      "Transaction confirmation timed out",
      txHash,
      status,
      true,
      lastPollingError === undefined ? undefined : { cause: lastPollingError },
    );
  }

  throw new TransactionConfirmationError(
    `Transaction ended with status: ${status ?? "unknown"}`,
    txHash,
    status,
    false,
  );
}

function isPendingStatus(status: string | undefined): boolean {
  return (
    status === undefined ||
    status === "sent" ||
    status === "pending" ||
    status === "proposed" ||
    status === "unknown"
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    getSleepScheduler()(resolve, ms);
  });
}

function getSleepScheduler(): SleepScheduler {
  const runtime = globalThis as typeof globalThis & {
    setTimeout?: SleepScheduler;
  };
  const schedule = runtime.setTimeout;
  if (!schedule) {
    throw new Error("setTimeout is unavailable in this runtime");
  }

  return schedule;
}

/**
 * SDK for managing iCKB operations.
 *
 * This facade intentionally stops at protocol-specific transaction construction.
 * Callers still own completion before send by explicitly calling
 * `completeTransaction(...)`.
 */
export class IckbSdk {
  /**
   * Creates an instance of IckbSdk.
   *
   * @param ickbUdt - The manager for iCKB UDT completion and account balance.
   * @param ownedOwner - The manager for owned owner operations.
   * @param ickbLogic - The manager for iCKB logic operations.
   * @param order - The manager for order operations.
   * @param bots - An array of bot lock scripts.
   */
  constructor(
    private readonly ickbUdt: IckbUdtCompleter,
    private readonly ownedOwner: OwnedOwnerManager,
    private readonly ickbLogic: LogicManager,
    private readonly order: OrderManager,
    private readonly bots: ccc.Script[],
  ) {}

  /**
   * Creates an instance of IckbSdk from script dependencies.
   *
   * @param args - Parameters matching those of getConfig.
   * @returns A new instance of IckbSdk.
   */
  static from(...args: Parameters<typeof getConfig>): IckbSdk {
    return IckbSdk.fromConfig(getConfig(...args));
  }

  static fromConfig(config: ReturnType<typeof getConfig>): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
      bots,
    } = config;

    return new IckbSdk(ickbUdt, ownedOwner, logic, order, bots);
  }

  async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    return completeIckbTransaction(txLike, this.ickbUdt, options);
  }

  /**
   * Previews the conversion between CKB and UDT.
   *
   * This method calculates a conversion preview using an exchange ratio midpoint.
   * Optionally, a fee may be applied that influences the effective conversion rate,
   * scaling the converted amount by (feeBase - fee) / feeBase.
   *
   * @param isCkb2Udt - Indicates the conversion direction:
   *                    - true: Convert CKB to UDT.
   *                    - false: Convert UDT to CKB.
   * @param amounts - An object containing value components (amounts for CKB and UDT).
   * @param system - The current system state containing exchange ratio, fee rate, tip, and order-related information.
   * @param options - Optional parameters for fee and matching:
   *    - fee: The fee to apply in integer terms (defaults to 1n for 0.001% fee).
   *    - feeBase: The base used for fee scaling (defaults to 100000n).
   *
   * @returns An object with:
   *   - convertedAmount: The estimated converted amount as a FixedPoint.
   *   - ckbFee: The fee (or gain) in CKB, as a FixedPoint.
   *   - info: Additional conversion metadata.
   *   - maturity: Optional maturity information when the fee/incentive threshold
   *     is met and the current pool state can estimate completion timing. The
   *     order info can still be valid when maturity is undefined.
   */
  static estimate(
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: {
      fee?: ccc.Num;
      feeBase?: ccc.Num;
    },
  ): {
    convertedAmount: ccc.FixedPoint;
    ckbFee: ccc.FixedPoint;
    info: Info;
    maturity: ccc.Num | undefined;
  } {
    // Apply a 0.001% default fee if none provided.
    options = {
      fee: 1n,
      feeBase: 100000n,
      ...options,
    };
    const { convertedAmount, ckbFee, info } = OrderManager.convert(
      isCkb2Udt,
      system.exchangeRatio,
      amounts,
      options,
    );

    // Only previews that clear the fee/incentive threshold get a maturity
    // estimate. Smaller previews still return convertedAmount/info.
    const maturity = ckbFee >= estimateMaturityFeeThreshold(system)
      ? IckbSdk.maturity({ info, amounts }, system)
      : undefined;

    return { convertedAmount, ckbFee, info, maturity };
  }

  static estimateIckbToCkbOrder(
    amounts: { ckbValue: bigint; udtValue: bigint },
    system: SystemState,
  ): IckbToCkbOrderEstimate | undefined {
    const estimate = IckbSdk.estimate(false, amounts, system);
    if (estimate.maturity !== undefined) {
      return { estimate, maturity: estimate.maturity };
    }

    if (estimate.convertedAmount === 0n) {
      return;
    }

    if (estimate.ckbFee >= estimateMaturityFeeThreshold(system)) {
      return {
        estimate,
        maturity: undefined,
        notice: {
          kind: "maturity-unavailable",
          inputIckb: amounts.udtValue,
          outputCkb: estimate.convertedAmount,
          incentiveCkb: positiveFee(estimate.ckbFee),
          maturityEstimateUnavailable: true,
        },
      };
    }

    const dustEstimate = estimateDustIckbToCkbOrder(amounts, system);
    const dustMaturity = IckbSdk.maturity(
      { info: dustEstimate.info, amounts },
      system,
    );

    return {
      estimate: dustEstimate,
      maturity: dustMaturity,
      notice: {
        kind: "dust-ickb-to-ckb",
        inputIckb: amounts.udtValue,
        outputCkb: dustEstimate.convertedAmount,
        incentiveCkb: positiveFee(dustEstimate.ckbFee),
        maturityEstimateUnavailable: dustMaturity === undefined,
      },
    };
  }

  /**
   * Estimates the maturity for an order formatted as a Unix timestamp.
   *
   * Depending on the order type and amount remaining, the method calculates an estimated timestamp
   * when the order (or part thereof) might be fulfilled.
   *
   * @param o - Either an OrderCell or an object containing order Info and value components.
   * @param system - The current system state.
   * @returns The Unix timestamp of estimated maturity as a bigint (in milliseconds),
   *          based on `system.tip.timestamp`, or undefined if not applicable.
   */
  static maturity(
    o:
      | OrderCell
      | {
          info: Info;
          amounts: ValueComponents;
        },
    system: SystemState,
  ): bigint | undefined {
    const info = "info" in o ? o.info : o.data.info;
    const amounts =
      "amounts" in o
        ? o.amounts
        : { ckbValue: o.ckbUnoccupied, udtValue: o.udtValue };

    // Dual-ratio orders have no fixed maturity.
    if (info.isDualRatio()) {
      return;
    }

    const isCkb2Udt = info.isCkb2Udt();
    const amount = isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
    const ratio = isCkb2Udt ? info.ckbToUdt : info.udtToCkb;

    // If order is already fulfilled.
    if (amount === 0n) {
      return 0n;
    }

    const { tip, exchangeRatio, orderPool, ckbAvailable, ckbMaturing } = system;

    // Create a reference ratio instance for comparison.
    const b = new Info(ratio, ratio, 1);
    let ckb = isCkb2Udt
      ? amount
      : amounts.ckbValue - ratio.convert(false, amount, true);
    let udt = 0n;
    for (const o of orderPool) {
      const a = o.data.info;
      if (a.isCkb2Udt()) {
        // If not isCkb2Udt or a worse ratio, add available CKB.
        if (!isCkb2Udt || a.ckb2UdtCompare(b) < 0) {
          ckb += o.ckbUnoccupied;
        }
      } else {
        // Conversely for UDT to CKB orders.
        if (isCkb2Udt || a.udt2CkbCompare(b) < 0) {
          udt += o.udtValue;
        }
      }
    }
    // Adjust ckb by the converted UDT amount.
    ckb -= convert(false, udt, exchangeRatio);

    // Minimum maturity of 10 minutes (in milliseconds).
    let maturity = 10n * 60n * 1000n;
    if (isCkb2Udt) {
      // For CKB to UDT orders, extend maturity based on the CKB amount.
      if (ckb > 0n) {
        maturity *= 1n + ckb / ccc.fixedPointFrom("200000");
      }
      return maturity + tip.timestamp;
    }

    // For UDT to CKB orders, add available CKB.
    ckb += ckbAvailable;
    if (ckb >= 0n) {
      return maturity + tip.timestamp;
    }

    // Find the earliest maturity in the ckbMaturing array that satisfies the required CKB.
    const ckbNeeded = -ckb;
    const i = binarySearch(
      ckbMaturing.length,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (n) => ckbMaturing[n]!.ckbCumulative >= ckbNeeded,
    );

    return ckbMaturing[i]?.maturity;
  }

  /**
   * Mints a new order cell and appends it to the transaction.
   *
   * The method performs the following operations:
   * - Creates order cell data using provided amounts and order information.
   * - Adds the required order cell dependencies to the transaction.
   * - Appends the order cell to the transaction outputs.
   *
   * @param txLike - The transaction to which the order cell is added.
   * @param user - The user, represented either as a Signer or a Script.
   * @param info - The order information meta data (usually computed via OrderManager.convert).
   * @param amounts - The value components for the order, including:
   *    - ckbValue: The CKB amount (may include an internal surplus).
   *    - udtValue: The UDT amount.
   *
   * @returns A Promise resolving to the updated transaction.
   *
   * @remarks The returned transaction is not finalized. Callers own the
   * completion pipeline and may use `completeTransaction(...)` before send.
   */
  async request(
    txLike: ccc.TransactionLike,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<ccc.Transaction> {
    // If the user is provided as a Signer, extract the recommended lock script.
    user =
      "codeHash" in user
        ? user
        : (await user.getRecommendedAddressObj()).script;

    return this.order.mint(txLike, user, info, amounts);
  }

  /**
   * Melts (cancels) the specified order groups.
   *
   * For each order group, if the option is set to process fulfilled orders only,
   * it filters accordingly. Then, for every valid group, the master and order cells are added
   * as inputs to the transaction.
   *
   * @param txLike - The transaction to which the inputs are added.
   * @param groups - An array of order groups to be melted.
   * @param options - Optional parameters:
   *    - isFulfilledOnly: If true, only order groups with fully or partially fulfilled orders are processed.
   *
   * @returns The updated transaction.
   *
   * @remarks The returned transaction is not finalized. Callers own the
   * completion pipeline and may use `completeTransaction(...)` before send.
   */
  collect(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: {
      isFulfilledOnly?: boolean;
    },
  ): ccc.Transaction {
    return this.order.melt(txLike, groups, options);
  }

  /**
   * Builds the shared partial transaction from currently actionable account state.
   *
   * This keeps the order of stack-owned steps in one place: optional withdrawal
   * requests first, then collect user orders, complete ready receipts, and
   * finalize ready withdrawals.
   *
   * @param txLike - The transaction to extend.
   * @param client - The blockchain client used by withdrawal completion.
   * @param options.withdrawalRequest - Optional DAO withdrawal request to append
   * before the input-only base activity.
   * @param options.withdrawalRequest.requiredLiveDeposits - Live deposit anchors
   * that must remain resolvable while the requested deposits are spent.
   * @param options.orders - User-owned order groups to collect.
   * @param options.receipts - Receipts ready for deposit phase 2 completion.
   * @param options.readyWithdrawals - Mature withdrawal groups ready to complete.
   * @returns A Promise resolving to the updated partial transaction.
   */
  async buildBaseTransaction(
    txLike: ccc.TransactionLike,
    client: ccc.Client,
    options?: {
      withdrawalRequest?: {
        deposits: IckbDepositCell[];
        requiredLiveDeposits?: IckbDepositCell[];
        lock: ccc.Script;
      };
      orders?: OrderGroup[];
      receipts?: ReceiptCell[];
      readyWithdrawals?: WithdrawalGroup[];
    },
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);

    const withdrawalRequest = options?.withdrawalRequest;
    if (withdrawalRequest?.deposits.length) {
      tx = await this.ownedOwner.requestWithdrawal(
        tx,
        withdrawalRequest.deposits,
        withdrawalRequest.lock,
        client,
        withdrawalRequest.requiredLiveDeposits?.length
          ? { requiredLiveDeposits: withdrawalRequest.requiredLiveDeposits }
          : undefined,
      );
    }

    if (options?.orders?.length) {
      tx = this.collect(tx, options.orders);
    }

    if (options?.receipts?.length) {
      tx = this.ickbLogic.completeDeposit(tx, options.receipts);
    }

    if (options?.readyWithdrawals?.length) {
      tx = await this.ownedOwner.withdraw(tx, options.readyWithdrawals, client);
    }

    return tx;
  }

  async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: { limit?: number },
  ): Promise<PoolDepositState> {
    const deposits = await collect(this.ickbLogic.findDeposits(client, {
      onChain: true,
      tip,
      limit: options?.limit ?? defaultFindCellsLimit,
    }));
    const readyDeposits = sortDepositsByMaturity(
      deposits.filter((deposit) => deposit.isReady),
      tip,
    );

    return {
      deposits,
      readyDeposits,
      id: poolDepositsKey(deposits, tip),
    };
  }

  async buildConversionTransaction(
    txLike: ccc.TransactionLike,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, context, direction } = options;
    if (amount < 0n) {
      return conversionFailure("amount-negative", context.estimatedMaturity);
    }

    if (direction === "ckb-to-ickb" && amount > context.ckbAvailable) {
      return conversionFailure("insufficient-ckb", context.estimatedMaturity);
    }

    if (direction === "ickb-to-ckb" && amount > context.ickbAvailable) {
      return conversionFailure("insufficient-ickb", context.estimatedMaturity);
    }

    const baseTx = ccc.Transaction.from(txLike);

    if (amount === 0n) {
      const tx = await this.buildBaseTransaction(
        baseTx,
        client,
        baseTransactionOptions(context),
      );
      if (!hasTransactionActivity(tx)) {
        return conversionFailure("nothing-to-do", context.estimatedMaturity);
      }

      return {
        ok: true,
        tx,
        estimatedMaturity: context.estimatedMaturity,
        conversion: { kind: "collect-only" },
      };
    }

    return direction === "ckb-to-ickb"
      ? await this.buildCkbToIckbConversion(baseTx, client, options)
      : await this.buildIckbToCkbConversion(baseTx, client, options);
  }

  private async buildCkbToIckbConversion(
    baseTx: ccc.Transaction,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, context, lock } = options;
    const maxDirectDeposits = normalizeCountLimit(
      options.limits?.maxDirectDeposits ?? MAX_DIRECT_DEPOSITS,
    );
    const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, context.system.exchangeRatio);
    const depositQuotient = depositCapacity === 0n ? 0n : amount / depositCapacity;
    const maxDeposits = depositQuotient > BigInt(maxDirectDeposits)
      ? maxDirectDeposits
      : Number(depositQuotient);
    let lastFailure: ConversionTransactionFailureReason | undefined;
    let lastError: unknown;

    for (let depositCount = maxDeposits; depositCount >= 0; depositCount -= 1) {
      const remainder = amount - depositCapacity * BigInt(depositCount);
      let estimatedMaturity = context.estimatedMaturity;
      let order: ConversionOrder | undefined;

      if (remainder > 0n) {
        const amounts = { ckbValue: remainder, udtValue: 0n };
        const estimate = IckbSdk.estimate(true, amounts, context.system);
        if (estimate.maturity === undefined) {
          lastFailure = "amount-too-small";
          continue;
        }

        estimatedMaturity = maxMaturity(estimatedMaturity, estimate.maturity);
        order = { amounts, estimate };
      }

      const outputLimitError = plannedDaoOutputLimitError(
        baseTx,
        (depositCount > 0 ? depositCount + 1 : 0) + orderOutputCount(order),
        depositCount > 0 || context.readyWithdrawals.length > 0,
      );
      if (outputLimitError) {
        lastFailure = undefined;
        lastError ??= outputLimitError;
        continue;
      }

      try {
        let tx = await this.buildBaseTransaction(
          baseTx.clone(),
          client,
          baseTransactionOptions(context),
        );
        if (depositCount > 0) {
          tx = await this.ickbLogic.deposit(
            tx,
            depositCount,
            depositCapacity,
            lock,
            client,
          );
        }
        if (order) {
          tx = await this.request(tx, lock, order.estimate.info, order.amounts);
        }

        return {
          ok: true,
          tx,
          estimatedMaturity,
          conversion: { kind: conversionKind(depositCount > 0, order !== undefined) },
        };
      } catch (error) {
        if (!isRetryableConversionBuildError(error)) {
          throw errorOf(error);
        }
        lastFailure = undefined;
        lastError ??= error;
      }
    }

    if (lastError !== undefined) {
      throw errorOf(lastError);
    }

    return conversionFailure(lastFailure ?? "nothing-to-do", context.estimatedMaturity);
  }

  private async buildIckbToCkbConversion(
    baseTx: ccc.Transaction,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, context, lock } = options;
    const maxWithdrawalRequests = normalizeCountLimit(
      options.limits?.maxWithdrawalRequests ?? MAX_WITHDRAWAL_REQUESTS,
    );
    const poolDeposits = context.system.poolDeposits ??
      await this.getPoolDeposits(client, context.system.tip);
    const candidates = sortDepositsByMaturity(
      poolDeposits.readyDeposits.filter((deposit) => deposit.isReady),
      context.system.tip,
    );
    const plans: IckbToCkbConversionPlan[] = [];
    const score = (deposit: IckbDepositCell): bigint =>
      directWithdrawalSurplus(deposit, context.system.exchangeRatio);
    let lastFailure: ConversionTransactionFailureReason | undefined;
    let lastError: unknown;

    for (
      let withdrawalCount = Math.min(candidates.length, maxWithdrawalRequests);
      withdrawalCount >= 0;
      withdrawalCount -= 1
    ) {
      const selections = withdrawalCount === 0
        ? [{ deposits: [], requiredLiveDeposits: [] }]
        : selectExactReadyWithdrawalDepositCandidates({
          readyDeposits: candidates,
          tip: context.system.tip,
          maxAmount: amount,
          count: withdrawalCount,
          preserveSingletons: amount < ICKB_DEPOSIT_CAP,
          score,
          maturityBucket: (deposit) =>
            maturityBucket(deposit.maturity.toUnix(context.system.tip)),
        });
      if (withdrawalCount > 0 && selections.length === 0) {
        lastFailure = "not-enough-ready-deposits";
        continue;
      }

      for (const selection of selections) {
        let estimatedMaturity = context.estimatedMaturity;
        let remainder = amount;
        let directUdtValue = 0n;
        let directSurplusCkb = 0n;
        let selectedDeposits: IckbDepositCell[] = [];
        let requiredLiveDeposits: IckbDepositCell[] = [];
        let order: ConversionOrder | undefined;

        if (withdrawalCount > 0) {
          ({ deposits: selectedDeposits, requiredLiveDeposits } = selection);
          directUdtValue = sumUdtValue(selectedDeposits);
          directSurplusCkb = sumDirectWithdrawalSurplus(
            selectedDeposits,
            context.system.exchangeRatio,
          );
          remainder -= directUdtValue;
          for (const deposit of selectedDeposits) {
            estimatedMaturity = maxMaturity(
              estimatedMaturity,
              deposit.maturity.toUnix(context.system.tip),
            );
          }
        }

        if (remainder > 0n) {
          const amounts = { ckbValue: 0n, udtValue: remainder };
          const preview = IckbSdk.estimateIckbToCkbOrder(amounts, context.system);
          if (!preview) {
            lastFailure = "amount-too-small";
            continue;
          }

          const { estimate, maturity, notice } = preview;
          if (maturity !== undefined) {
            estimatedMaturity = maxMaturity(estimatedMaturity, maturity);
          }
          order = { amounts, estimate, conversionNotice: notice };
        }

        const outputLimitError = plannedDaoOutputLimitError(
          baseTx,
          selectedDeposits.length * 2 + orderOutputCount(order),
          selectedDeposits.length > 0 || context.readyWithdrawals.length > 0,
        );
        if (outputLimitError) {
          lastFailure = undefined;
          lastError ??= outputLimitError;
          continue;
        }

        plans.push({
          directSurplusCkb,
          directUdtValue,
          estimatedMaturity,
          order,
          requiredLiveDeposits,
          selectedDeposits,
        });
      }
    }

    plans.sort((left, right) => {
      const maturityCompare = compareBigInt(
        maturityBucket(left.estimatedMaturity),
        maturityBucket(right.estimatedMaturity),
      );
      if (maturityCompare !== 0) {
        return maturityCompare;
      }

      const directPresenceCompare = Number(right.selectedDeposits.length > 0) -
        Number(left.selectedDeposits.length > 0);
      if (directPresenceCompare !== 0) {
        return directPresenceCompare;
      }

      const surplusCompare = compareBigInt(right.directSurplusCkb, left.directSurplusCkb);
      if (surplusCompare !== 0) {
        return surplusCompare;
      }

      const directCompare = compareBigInt(right.directUdtValue, left.directUdtValue);
      return directCompare !== 0
        ? directCompare
        : right.selectedDeposits.length - left.selectedDeposits.length;
    });

    for (const {
      estimatedMaturity,
      order,
      requiredLiveDeposits,
      selectedDeposits,
    } of plans) {
      try {
        let tx = await this.buildBaseTransaction(
          baseTx.clone(),
          client,
          baseTransactionOptions(context, {
            deposits: selectedDeposits,
            requiredLiveDeposits,
            lock,
          }),
        );
        if (order) {
          tx = await this.request(tx, lock, order.estimate.info, order.amounts);
        }

        return {
          ok: true,
          tx,
          estimatedMaturity,
          conversion: {
            kind: conversionKind(selectedDeposits.length > 0, order !== undefined),
          },
          ...(order?.conversionNotice
            ? { conversionNotice: order.conversionNotice }
            : {}),
        };
      } catch (error) {
        if (!isRetryableConversionBuildError(error)) {
          throw errorOf(error);
        }
        lastFailure = undefined;
        lastError ??= error;
      }
    }

    if (lastError !== undefined) {
      throw errorOf(lastError);
    }

    return conversionFailure(lastFailure ?? "nothing-to-do", context.estimatedMaturity);
  }

  async getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
    options?: { limit?: number },
  ): Promise<AccountState> {
    const [cells, receipts, withdrawalGroups] = await Promise.all([
      this.findAccountCells(client, locks, options),
      collect(this.ickbLogic.findReceipts(client, locks, { onChain: true })),
      collect(
        this.ownedOwner.findWithdrawalGroups(client, locks, {
          onChain: true,
          tip,
        }),
      ),
    ]);
    const nativeUdtCells = cells.filter((cell) => this.ickbUdt.isUdt(cell));
    const nativeUdtInfo = await this.ickbUdt.infoFrom(
      client,
      nativeUdtCells,
    );

    return {
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCells,
      nativeUdtCapacity: nativeUdtInfo.capacity,
      nativeUdtBalance: nativeUdtInfo.balance,
      receipts,
      withdrawalGroups,
    };
  }

  async getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1AccountStateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }> {
    const { system, user } = await this.getL1State(client, locks, options);
    const account = await this.getAccountState(client, locks, system.tip, {
      limit: options?.accountLimit,
    });
    await this.assertCurrentTip(client, system.tip);

    return { system, user, account };
  }

  /**
   * Retrieves the L1 state from the blockchain.
   *
   * The method performs the following:
   * - Obtains the current block tip and calculates the exchange ratio.
   * - Fetches available CKB and the maturing CKB based on bot capacities and direct deposit scans.
   * - Filters orders into user-owned and system orders based on the provided locks.
   * - Estimates user-owned orders maturity.
   *
   * @param client - The blockchain client interface.
   * @param locks - An array of lock scripts used to filter user cells.
   * @returns A promise that resolves to an object containing:
   *   - system: The system state (fee rate, tip header, exchange ratio, order pool, etc.).
   *   - user: The user's orders grouped as an array of OrderGroup.
   */
  async getL1State(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }> {
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));

    // Parallel fetching of system components.
    const [poolDeposits, orders, feeRate] = await Promise.all([
      this.getPoolDeposits(client, tip, { limit: options?.poolDepositLimit }),
      collect(this.order.findOrders(client, {
        onChain: true,
        limit: options?.orderLimit ?? defaultFindCellsLimit,
      })),
      client.getFeeRate(),
    ]);
    const { ckbAvailable, ckbMaturing } = await this.getCkb(client, tip, poolDeposits);

    const midInfo = new Info(exchangeRatio, exchangeRatio, 1);
    const userOrders: OrderGroup[] = [];
    const systemOrders: OrderCell[] = [];
    for (const group of orders) {
      if (group.isOwner(...locks)) {
        userOrders.push(group);
        continue;
      }

      const { order } = group;
      const info = order.data.info;
      if (
        (order.isCkb2UdtMatchable() && info.ckb2UdtCompare(midInfo) < 0) ||
        (order.isUdt2CkbMatchable() && info.udt2CkbCompare(midInfo) < 0)
      ) {
        systemOrders.push(order);
      }
    }

    const system = {
      feeRate,
      tip,
      exchangeRatio,
      orderPool: systemOrders,
      ckbAvailable,
      ckbMaturing,
      poolDeposits,
    };
    await this.assertCurrentTip(client, tip);

    return {
      system,
      user: {
        orders: userOrders.map((group) => orderGroupWithMaturity(group, system)),
      },
    };
  }

  /**
   * Retrieves available CKB and maturing CKB values from the blockchain.
   *
   * This method:
   * - Fetches bot withdrawal requests and bot plain-capacity balances.
   * - Aggregates available CKB balances from bot capacities.
   * - Calculates maturing CKB values (with their expected maturity timestamps)
   *   via direct deposit cell lookups.
   * - Sorts and cumulatively sums the maturing values for later lookup.
   *
   * @param client - The blockchain client used for fetching data.
   * @param tip - The current block tip header.
   * @returns A Promise that resolves with:
   *   - ckbAvailable: The total available CKB (as a FixedPoint).
   *   - ckbMaturing: An array of maturing CKB objects containing the cumulative CKB
   *                  and the associated maturity timestamp.
   */
  private async getCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    poolDeposits: PoolDepositState,
  ): Promise<{
    ckbAvailable: ccc.FixedPoint;
    ckbMaturing: CkbCumulative[];
  }> {
    const limit = defaultFindCellsLimit;
    const withdrawalOptions = {
      onChain: true,
      tip,
      limit,
    };
    // Map to track each bot's available CKB (minus a reserved amount for internal operations).
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    const reserved = -ccc.fixedPointFrom("2000");
    for (const lock of unique(this.bots)) {
      const key = lock.toHex();
      for (const cell of await collectCompleteScan(
        (scanLimit) => client.findCellsOnChain(
          {
            script: lock,
            scriptType: "lock",
            filter: {
              scriptLenRange: [0n, 1n],
              outputDataLenRange: [0n, 1n],
            },
            scriptSearchMode: "exact",
            withData: true,
          },
          "asc",
          scanLimit,
        ),
        { limit, label: "bot capacity", context: lock },
      )) {
        if (isPlainCapacityCell(cell)) {
          const ckb =
            (bot2Ckb.get(key) ?? reserved) + cell.cellOutput.capacity;
          bot2Ckb.set(key, ckb);
        }
      }
    }

    const ckbMaturing = new Array<{
      ckbValue: ccc.FixedPoint;
      maturity: ccc.Num;
    }>();
    const botWithdrawals = await collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, withdrawalOptions),
    );
    for (const wr of botWithdrawals) {
      if (wr.owned.isReady) {
        // Update the bot's CKB based on withdrawal if the bot is ready.
        const key = wr.owner.cell.cellOutput.lock.toHex();
        const ckb = (bot2Ckb.get(key) ?? reserved) + wr.ckbValue;
        bot2Ckb.set(key, ckb);
        continue;
      }

      // Otherwise, add to maturing amounts.
      ckbMaturing.push({
        ckbValue: wr.ckbValue,
        maturity: wr.owned.maturity.toUnix(tip),
      });
    }

    // Sum available CKB across all bot lock scripts.
    let ckbAvailable = 0n;
    for (const ckb of bot2Ckb.values()) {
      if (ckb > 0n) {
        ckbAvailable += ckb;
      }
    }

    // Bot-owned no-type data cells are not distinguishable from arbitrary payloads,
    // so the SDK currently falls back to direct deposit scanning instead of trusting
    // snapshot-like bytes from wallet-owned cells.
    for (const d of poolDeposits.deposits) {
      if (d.isReady) {
        ckbAvailable += d.ckbValue;
        continue;
      }

      ckbMaturing.push({
        ckbValue: d.ckbValue,
        maturity: d.maturity.toUnix(tip),
      });
    }

    // Sort maturing CKB entries by their maturity timestamp.
    ckbMaturing.sort((a, b) => compareBigInt(a.maturity, b.maturity));

    // Calculate cumulative maturing CKB values.
    let cumulative = 0n;
    const ckbCumulativeMaturing: CkbCumulative[] = [];
    for (const { ckbValue, maturity } of ckbMaturing) {
      cumulative += ckbValue;
      ckbCumulativeMaturing.push({ ckbCumulative: cumulative, maturity });
    }

    return {
      ckbAvailable,
      ckbMaturing: ckbCumulativeMaturing,
    };
  }

  private async findAccountCells(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: { limit?: number },
  ): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const limit = options?.limit ?? defaultFindCellsLimit;
    for (const lock of unique(locks)) {
      cells.push(...await collectCompleteScan(
        (scanLimit) => client.findCellsOnChain(
          {
            script: lock,
            scriptType: "lock",
            scriptSearchMode: "exact",
            withData: true,
          },
          "asc",
          scanLimit,
        ),
        { limit, label: "account", context: lock },
      ));
    }
    return cells;
  }

  async assertCurrentTip(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
  ): Promise<void> {
    const currentTip = await client.getTipHeader();
    if (currentTip.hash !== tip.hash) {
      throw new Error("L1 state scan crossed chain tip; retry with a fresh state");
    }
  }
}

type BuildBaseTransactionOptions = NonNullable<
  Parameters<IckbSdk["buildBaseTransaction"]>[2]
>;

interface ConversionOrder {
  amounts: ValueComponents;
  estimate: ReturnType<typeof IckbSdk.estimate>;
  conversionNotice?: ConversionNotice;
}

interface IckbToCkbConversionPlan {
  directSurplusCkb: bigint;
  directUdtValue: bigint;
  estimatedMaturity: bigint;
  order?: ConversionOrder;
  requiredLiveDeposits: IckbDepositCell[];
  selectedDeposits: IckbDepositCell[];
}

function conversionFailure(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity: bigint,
): ConversionTransactionResult {
  return { ok: false, reason, estimatedMaturity };
}

function baseTransactionOptions(
  context: ConversionTransactionContext,
  withdrawalRequest?: {
    deposits: IckbDepositCell[];
    requiredLiveDeposits: IckbDepositCell[];
    lock: ccc.Script;
  },
): BuildBaseTransactionOptions {
  return {
    withdrawalRequest:
      withdrawalRequest === undefined || withdrawalRequest.deposits.length === 0
        ? undefined
        : {
            deposits: withdrawalRequest.deposits,
            ...(withdrawalRequest.requiredLiveDeposits.length > 0
              ? { requiredLiveDeposits: withdrawalRequest.requiredLiveDeposits }
              : {}),
            lock: withdrawalRequest.lock,
          },
    orders: context.availableOrders,
    receipts: context.receipts,
    readyWithdrawals: context.readyWithdrawals,
  };
}

function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
}

function errorOf(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const message = errorMessage(error);
  return new Error(message, { cause: error });
}

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRetryableConversionBuildError(error: unknown): boolean {
  return error instanceof DaoOutputLimitError ||
    error instanceof Error && error.name === "DaoOutputLimitError";
}

function plannedDaoOutputLimitError(
  tx: ccc.Transaction,
  additionalOutputs: number,
  hasDaoActivity: boolean,
): DaoOutputLimitError | undefined {
  if (!hasDaoActivity) {
    return;
  }

  const outputCount = tx.outputs.length + additionalOutputs;
  return outputCount > DAO_OUTPUT_LIMIT
    ? new DaoOutputLimitError(outputCount)
    : undefined;
}

function orderOutputCount(order: ConversionOrder | undefined): number {
  return order ? ORDER_MINT_OUTPUTS : 0;
}

function conversionKind(
  hasDirect: boolean,
  hasOrder: boolean,
): ConversionMetadata["kind"] {
  if (hasDirect && hasOrder) {
    return "direct-plus-order";
  }
  if (hasDirect) {
    return "direct";
  }
  if (hasOrder) {
    return "order";
  }
  return "collect-only";
}

function estimateDustIckbToCkbOrder(
  amounts: ValueComponents,
  system: SystemState,
): ReturnType<typeof IckbSdk.estimate> {
  const baseEstimate = IckbSdk.estimate(false, amounts, system, {
    fee: 0n,
  });
  const targetFee = estimateMaturityFeeThreshold(system);
  const feeBase = baseEstimate.convertedAmount + 1n;
  if (targetFee <= 0n || feeBase <= 1n) {
    return baseEstimate;
  }

  const estimateWithFee = (fee: bigint): ReturnType<typeof IckbSdk.estimate> =>
    IckbSdk.estimate(false, amounts, system, {
      fee,
      feeBase,
    });

  const highestFee = feeBase - 1n;
  const highestDiscount = estimateWithFee(highestFee);
  if (highestDiscount.ckbFee < targetFee) {
    return highestDiscount;
  }

  let low = 0n;
  let high = highestFee;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (estimateWithFee(mid).ckbFee >= targetFee) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }

  return estimateWithFee(low);
}

function normalizeCountLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

function sumUdtValue(deposits: readonly IckbDepositCell[]): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += deposit.udtValue;
  }
  return total;
}

function sumDirectWithdrawalSurplus(
  deposits: readonly IckbDepositCell[],
  exchangeRatio: Ratio,
): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += directWithdrawalSurplus(deposit, exchangeRatio);
  }
  return total;
}

function directWithdrawalSurplus(deposit: IckbDepositCell, exchangeRatio: Ratio): bigint {
  return deposit.ckbValue - convert(false, deposit.udtValue, exchangeRatio);
}

function poolDepositsKey(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): string {
  return deposits
    .map((deposit) => [
      deposit.cell.outPoint.toHex(),
      deposit.isReady ? "ready" : "pending",
      String(deposit.ckbValue),
      String(deposit.udtValue),
      String(deposit.maturity.toUnix(tip)),
    ].join("@"))
    .sort()
    .join(",");
}

function sortDepositsByMaturity(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): IckbDepositCell[] {
  return [...deposits].sort((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip))
  );
}

function positiveOrZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function positiveFee(fee: bigint): bigint {
  return positiveOrZero(fee);
}

function maxMaturity(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function maturityBucket(maturity: bigint): bigint {
  return maturity / CONVERSION_MATURITY_BUCKET_MS;
}

function orderGroupWithMaturity(group: OrderGroup, system: SystemState): OrderGroup {
  const { order } = group;
  return new OrderGroup(
    group.master,
    new OrderCell(
      order.cell,
      order.data,
      order.ckbUnoccupied,
      order.absTotal,
      order.absProgress,
      IckbSdk.maturity(order, system),
    ),
    group.origin,
  );
}

export interface AccountState {
  capacityCells: ccc.Cell[];
  nativeUdtCells: ccc.Cell[];
  nativeUdtCapacity: bigint;
  nativeUdtBalance: bigint;
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroup[];
}

export interface AccountAvailabilityProjection {
  ckbNative: bigint;
  ickbNative: bigint;
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  ckbPending: bigint;
  ickbPending: bigint;
  ckbBalance: bigint;
  ickbBalance: bigint;
  readyWithdrawals: WithdrawalGroup[];
  pendingWithdrawals: WithdrawalGroup[];
  availableOrders: OrderGroup[];
  pendingOrders: OrderGroup[];
}

export function projectAccountAvailability(
  account: AccountState,
  userOrders: OrderGroup[],
  options?: {
    /**
     * Treat matchable orders as available only when the caller will collect them
     * before spending the projected balance in the same transaction.
     */
    collectedOrdersAvailable?: boolean;
  },
): AccountAvailabilityProjection {
  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of account.withdrawalGroups) {
    if (group.owned.isReady) {
      readyWithdrawals.push(group);
    } else {
      pendingWithdrawals.push(group);
    }
  }

  const availableOrders: OrderGroup[] = [];
  const pendingOrders: OrderGroup[] = [];
  for (const group of userOrders) {
    if (
      options?.collectedOrdersAvailable ||
      group.order.isDualRatio() ||
      !group.order.isMatchable()
    ) {
      availableOrders.push(group);
    } else {
      pendingOrders.push(group);
    }
  }

  const ckbNative = sumValues(
    account.capacityCells,
    (cell) => cell.cellOutput.capacity,
  );
  const ickbNative = account.nativeUdtBalance;
  const ckbAvailable =
    ckbNative +
    sumCkb(account.receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  const ickbAvailable =
    ickbNative +
    sumUdt(account.receipts) +
    sumUdt(availableOrders);
  const ckbPending = sumCkb(pendingWithdrawals) + sumCkb(pendingOrders);
  const ickbPending = sumUdt(pendingOrders);

  return {
    ckbNative,
    ickbNative,
    ckbAvailable,
    ickbAvailable,
    ckbPending,
    ickbPending,
    ckbBalance: ckbAvailable + ckbPending,
    ickbBalance: ickbAvailable + ickbPending,
    readyWithdrawals,
    pendingWithdrawals,
    availableOrders,
    pendingOrders,
  };
}

function sumCkb(items: { ckbValue: bigint }[]): bigint {
  return sumValues(items, (item) => item.ckbValue);
}

function sumUdt(items: { udtValue: bigint }[]): bigint {
  return sumValues(items, (item) => item.udtValue);
}

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
}

/**
 * Represents the state of the system.
 */
export interface SystemState {
  /** The fee rate for transactions. */
  feeRate: ccc.Num;

  /** The tip for the current block header. */
  tip: ccc.ClientBlockHeader;

  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: Ratio;

  /** The order pool containing order cells matching system criteria. */
  orderPool: OrderCell[];

  /** The total available CKB (as FixedPoint). */
  ckbAvailable: ccc.FixedPoint;

  /** Array of CKB maturing entries with cumulative amounts and maturity timestamps. */
  ckbMaturing: CkbCumulative[];

  /** Complete public pool deposit snapshot for conversion planning at this tip. */
  poolDeposits?: PoolDepositState;
}

export function estimateMaturityFeeThreshold(
  system: Pick<SystemState, "feeRate">,
): bigint {
  return 10n * system.feeRate;
}

/**
 * Represents a cumulative CKB maturing entry.
 */
export interface CkbCumulative {
  /** The cumulative CKB value (as FixedPoint) up to this maturity. */
  ckbCumulative: ccc.FixedPoint;
  /** The maturity timestamp (as ccc.Num). */
  maturity: ccc.Num;
}
