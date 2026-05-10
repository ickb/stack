import {
  projectAccountAvailability,
  type SystemState,
} from "@ickb/sdk";
import {
  buildTransactionPreview,
  type TransactionContext,
} from "./transaction.ts";
import { type TxInfo, type WalletConfig } from "./utils.ts";

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
): readonly [WalletConfig["chain"], string, "l1State"] {
  return [walletConfig.chain, walletConfig.address, "l1State"] as const;
}

export function l1StateOptions(
  walletConfig: WalletConfig,
  isFrozen: boolean,
): {
  retry: number;
  refetchInterval: (context: { state: { data?: L1StateType } }) => number;
  staleTime: number;
  queryKey: readonly [WalletConfig["chain"], string, "l1State"];
  queryFn: () => Promise<L1StateType>;
  enabled: boolean;
} {
  return {
    retry: 2,
    refetchInterval: ({ state }) => 60000 * (state.data?.hasMatchable ? 1 : 10),
    staleTime: 10000,
    queryKey: l1StateQueryKey(walletConfig),
    queryFn: async () => await getL1State(walletConfig),
    enabled: !isFrozen,
  };
}

export async function getL1State(
  walletConfig: WalletConfig,
): Promise<L1StateType> {
  const sdkState = await walletConfig.sdk.getL1State(
    walletConfig.cccClient,
    walletConfig.accountLocks,
  );
  const { system, user } = sdkState;
  const account = await walletConfig.sdk.getAccountState(
    walletConfig.cccClient,
    walletConfig.accountLocks,
    system.tip,
  );
  const projection = projectAccountAvailability(account, user.orders);
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
    stateId: [
      walletConfig.chain,
      String(system.tip.timestamp),
      String(account.receipts.length),
      String(readyWithdrawals.length),
      String(pendingWithdrawals.length),
      String(availableOrders.length),
      String(pendingOrders.length),
    ].join(":"),
    txBuilder: (isCkb2Udt, amount) =>
      buildTransactionPreview(txContext, isCkb2Udt, amount, walletConfig),
    hasMatchable: pendingOrders.length > 0,
  };
}
