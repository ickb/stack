import { ccc } from "@ckb-ccc/core";
import { type OrderGroup } from "@ickb/order";
import {
  IckbSdk,
  projectConversionTransactionContext,
  type AccountState,
  type ConversionTransactionContext,
  type ConversionDirection,
  type ConversionMetadata,
  type SystemState,
} from "@ickb/sdk";

export interface Runtime {
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  primaryLock: ccc.Script;
  accountLocks: ccc.Script[];
}

export interface TesterState {
  system: SystemState;
  account: AccountState;
  userOrders: OrderGroup[];
  conversionContext: ConversionTransactionContext;
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
}

export interface RawOrderRequest {
  amounts: { ckbValue: bigint; udtValue: bigint };
  info: Parameters<IckbSdk["request"]>[2];
}

export async function readTesterState(runtime: Runtime): Promise<TesterState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
  );

  const { projection, context } = projectConversionTransactionContext(system, account, user.orders, {
    collectedOrdersAvailable: true,
  });

  return {
    system,
    account,
    userOrders: user.orders,
    conversionContext: context,
    availableCkbBalance: projection.ckbAvailable,
    availableIckbBalance: projection.ickbAvailable,
  };
}

export async function buildRawOrderTransaction(
  runtime: Runtime,
  state: TesterState,
  orders: RawOrderRequest[],
): Promise<ccc.Transaction> {
  let tx = await runtime.sdk.buildBaseTransaction(
    ccc.Transaction.default(),
    runtime.client,
    {
      orders: state.userOrders,
      receipts: state.conversionContext.receipts,
      readyWithdrawals: state.conversionContext.readyWithdrawals,
    },
  );

  for (const order of orders) {
    tx = await runtime.sdk.request(tx, runtime.primaryLock, order.info, order.amounts);
  }
  return runtime.sdk.completeTransaction(tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });
}

export async function buildSdkConversionTransaction(
  runtime: Runtime,
  state: TesterState,
  direction: ConversionDirection,
  amount: bigint,
): Promise<{ tx: ccc.Transaction; conversion: ConversionMetadata }> {
  const result = await runtime.sdk.buildConversionTransaction(
    ccc.Transaction.default(),
    runtime.client,
    {
      direction,
      amount,
      lock: runtime.primaryLock,
      context: state.conversionContext,
    },
  );
  if (!result.ok) {
    throw new Error(`SDK conversion failed: ${result.reason}`);
  }

  const tx = await runtime.sdk.completeTransaction(result.tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });
  return { tx, conversion: result.conversion };
}
