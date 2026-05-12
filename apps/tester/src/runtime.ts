import { ccc } from "@ckb-ccc/core";
import { type ReceiptCell, type WithdrawalGroup } from "@ickb/core";
import { type OrderGroup } from "@ickb/order";
import {
  IckbSdk,
  projectAccountAvailability,
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
  userOrders: OrderGroup[];
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
}

export async function readTesterState(runtime: Runtime): Promise<TesterState> {
  const { system, user, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
  );

  const projection = projectAccountAvailability(account, user.orders, {
    collectedOrdersAvailable: true,
  });

  return {
    system,
    userOrders: user.orders,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    availableCkbBalance: projection.ckbAvailable,
    availableIckbBalance: projection.ickbAvailable,
  };
}

export async function buildTransaction(
  runtime: Runtime,
  state: TesterState,
  amounts: { ckbValue: bigint; udtValue: bigint },
  info: Parameters<IckbSdk["request"]>[2],
): Promise<ccc.Transaction> {
  let tx = await runtime.sdk.buildBaseTransaction(
    ccc.Transaction.default(),
    runtime.client,
    {
      orders: state.userOrders,
      receipts: state.receipts,
      readyWithdrawals: state.readyWithdrawals,
    },
  );

  tx = await runtime.sdk.request(tx, runtime.primaryLock, info, amounts);
  return runtime.sdk.completeTransaction(tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });
}
