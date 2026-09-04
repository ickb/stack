import { ickbExchangeRatio } from "@ickb/core";
import { Ratio } from "@ickb/order";
import { projectConversionTransactionContext, type SystemState } from "@ickb/sdk";
import {
  buildTransactionPreview,
  type TransactionContext,
} from "../action/transaction.ts";
import type { RootConfig, TxInfo, WalletConfig } from "../shared/utils.ts";
import { l1StateQueryKey } from "./l1StateQueryKey.ts";
import { buildStateId } from "./queryStateId.ts";
import { rootConfigQueryKey } from "./rootConfigQueryKey.ts";

interface QuoteStateConfig {
  chain: RootConfig["chain"];
  cccClient: RootConfig["cccClient"];
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
  hasCollectable: boolean;
}

export interface QuoteState {
  exchangeRatio: Ratio;
  tipTimestamp?: bigint;
}

/**
 * Builds the L1 account query key for a wallet and its current lock set.
 *
 * @remarks The key is structural for chain, address, primary lock, and account locks, so replacing the wallet object alone does not invalidate the cache.
 */
export function l1StateOptions(
  walletConfig: WalletConfig,
  isFrozen: boolean,
): {
  enabled: boolean;
  retry: number;
  refetchInterval: number;
  queryKey: readonly [WalletConfig["chain"], string, string, "l1State"];
  queryFn: () => Promise<L1StateType>;
} {
  return {
    enabled: !isFrozen,
    retry: 2,
    refetchInterval: 60_000,
    queryKey: l1StateQueryKey(walletConfig),
    queryFn: async () => getL1State(walletConfig),
  };
}

/**
 * Builds quote query options for chain-level exchange and DAO rate state.
 *
 * @remarks The query key is rooted in the root config key, including the client object identity used to read the tip header.
 */
export function quoteStateOptions(rootConfig: QuoteStateConfig): {
  retry: number;
  refetchInterval: number;
  queryKey: readonly [RootConfig["chain"], number, "rootConfig", "quoteState"];
  queryFn: () => Promise<QuoteState>;
} {
  return {
    retry: 2,
    refetchInterval: 60_000,
    queryKey: [...rootConfigQueryKey(rootConfig), "quoteState"] as const,
    queryFn: async (): Promise<QuoteState> => {
      const tipHeader = await rootConfig.cccClient.getTipHeader();
      return {
        exchangeRatio: Ratio.from(ickbExchangeRatio(tipHeader)),
        tipTimestamp: tipHeader.timestamp,
      };
    },
  };
}

/**
 * Loads L1 account state and prepares the transaction-preview context for the current wallet.
 *
 * @remarks The returned stateId covers the account, protocol, balance, and cell
 * inputs captured in the transaction context. The builder still closes over
 * the current wallet config, SDK, client, and signer supplied by the UI.
 */
export async function getL1State(walletConfig: WalletConfig): Promise<L1StateType> {
  const sdkState = await walletConfig.sdk.getL1AccountState(
    walletConfig.cccClient,
    walletConfig.accountLocks,
  );
  const { system, user, account } = sdkState;
  const { projection, context: conversionContext } = projectConversionTransactionContext(
    system,
    account,
    user.orders,
  );
  const {
    ckbNative,
    ickbNative,
    ckbBalance,
    ickbBalance,
    ckbAvailable,
    ickbAvailable,
    pendingWithdrawals,
    pendingOrders,
  } = projection;

  const txContext: TransactionContext = {
    ...conversionContext,
    capacityCells: account.capacityCells,
    nativeUdtCells: account.nativeUdtCells,
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
    txBuilder: async (isCkb2Udt, amount) =>
      buildTransactionPreview(txContext, isCkb2Udt, amount, walletConfig),
    hasCollectable:
      conversionContext.availableOrders.length > 0 ||
      conversionContext.receipts.length > 0 ||
      conversionContext.readyWithdrawals.length > 0,
  };
}
