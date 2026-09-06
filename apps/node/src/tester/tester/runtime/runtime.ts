import { ccc } from "@ckb-ccc/core";
import {
  accountPlainCkbBalance,
  type AccountState,
  type ConversionDirection,
  type ConversionMetadata,
  type ConversionNotice,
  type ConversionTransactionContext,
  type IckbSdk,
  type OrderGroup,
  projectConversionTransactionContext,
  type SystemState,
} from "@ickb/sdk";

/** Runtime dependencies used by tester attempts. */
export interface Runtime {
  /** CCC client for the configured chain. */
  client: ccc.Client;

  /** Private-key signer; signing is its only secret-bearing purpose. */
  signer: ccc.SignerCkbPrivateKey;

  /** SDK instance used for state scans and transaction construction. */
  sdk: IckbSdk;

  /** Primary lock controlled by the signer. */
  primaryLock: ccc.Script;

  /** All account locks considered owned by the tester. */
  accountLocks: ccc.Script[];
}

/** State snapshot used for one tester planning attempt. */
export interface TesterState {
  /** Sampled public L1 state. */
  system: SystemState;

  /** Tester account state from the sampled scan. */
  account: AccountState;

  /** Tester-owned order groups available for collection. */
  userOrders: OrderGroup[];

  /** Conversion context built from system, account, and user-order state. */
  conversionContext: ConversionTransactionContext;

  /** Projected CKB available for tester actions. */
  availableCkbBalance: bigint;

  /** Projected CKB unavailable while withdrawals or orders are pending. */
  pendingCkbBalance: bigint;

  /** Total projected CKB including pending positions. */
  totalCkbBalance: bigint;

  /** Plain CKB balance used by the tester reserve guard. */
  plainCkbBalance: bigint;

  /** Projected iCKB available for tester actions. */
  availableIckbBalance: bigint;

  /** Projected iCKB unavailable while orders are pending. */
  pendingIckbBalance: bigint;

  /** Total projected iCKB including pending positions. */
  totalIckbBalance: bigint;
}

/** Raw order request passed through `IckbSdk.request`. */
export interface RawOrderRequest {
  /** CKB/iCKB amounts placed in the order. */
  amounts: { ckbValue: bigint; udtValue: bigint };

  /** Precomputed order info, including direction and limit ratio. */
  info: Parameters<IckbSdk["request"]>[2];
}

/**
 * Reads tester account state and builds the conversion context for one attempt.
 */
export async function readTesterState(runtime: Runtime): Promise<TesterState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
  );

  const { projection, context } = projectConversionTransactionContext(
    system,
    account,
    user.orders,
    {
      collectedOrdersAvailable: true,
    },
  );

  return {
    system,
    account,
    userOrders: user.orders,
    conversionContext: context,
    availableCkbBalance: projection.ckbAvailable,
    pendingCkbBalance: projection.ckbPending,
    totalCkbBalance: projection.ckbBalance,
    plainCkbBalance: accountPlainCkbBalance(account.capacityCells, runtime.accountLocks),
    availableIckbBalance: projection.ickbAvailable,
    pendingIckbBalance: projection.ickbPending,
    totalIckbBalance: projection.ickbBalance,
  };
}

/**
 * Builds and completes a tester transaction containing raw order requests.
 *
 * @remarks The returned transaction is complete for signing and sending. It may
 * include collect steps for user orders, receipts, and ready withdrawals before
 * appending the requested orders.
 */
export async function buildRawOrderTransaction(
  runtime: Runtime,
  state: TesterState,
  orders: RawOrderRequest[],
): Promise<ccc.Transaction> {
  let tx = runtime.sdk.buildBaseTransaction(ccc.Transaction.default(), {
    orders: state.userOrders,
    receipts: state.conversionContext.receipts,
    readyWithdrawals: state.conversionContext.readyWithdrawals,
  });

  for (const order of orders) {
    tx = await runtime.sdk.request(tx, runtime.primaryLock, order.info, order.amounts);
  }
  return runtime.sdk.completeTransaction(tx, {
    signer: runtime.signer,
    feeRate: state.system.feeRate,
  });
}

/**
 * Builds a tester transaction through the public SDK conversion path, which completes it.
 *
 * @throws Error when the SDK reports an expected conversion planning failure.
 */
export async function buildSdkConversionTransaction(
  runtime: Runtime,
  state: TesterState,
  direction: ConversionDirection,
  amount: bigint,
): Promise<{
  tx: ccc.Transaction;
  conversion: ConversionMetadata;
  conversionNotice?: ConversionNotice;
}> {
  const result = await runtime.sdk.buildConversionTransaction(ccc.Transaction.default(), {
    direction,
    amount,
    lock: runtime.primaryLock,
    signer: runtime.signer,
    context: state.conversionContext,
  });
  if (!result.ok) {
    throw new Error(`SDK conversion failed: ${result.reason}`);
  }

  return {
    tx: result.tx,
    conversion: result.conversion,
    ...(result.conversionNotice === undefined
      ? {}
      : { conversionNotice: result.conversionNotice }),
  };
}
