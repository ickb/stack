import {
  ickbExchangeRatio,
  isRefused,
  projectConversionTransactionContext,
  Ratio,
  type SystemState,
} from "@ickb/sdk";
import type { Destination } from "../action/destination.ts";
import {
  buildTransactionPreview,
  type TransactionContext,
} from "../action/transaction.ts";
import type { RootConfig, TxInfo, WalletConfig } from "../shared/utils.ts";
import { l1StateQueryKey } from "./l1StateQueryKey.ts";
import { objectIdentityKey, rootConfigQueryKey } from "./rootConfigQueryKey.ts";

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
  txBuilder: (
    isCkb2Udt: boolean,
    amount: bigint,
    destination: Destination,
  ) => Promise<TxInfo>;
  hasCollectable: boolean;
}

export interface QuoteState {
  exchangeRatio: Ratio;
  tipTimestamp?: bigint;
}

/** Builds the L1 account query options for one wallet config. */
export function l1StateOptions(
  walletConfig: WalletConfig,
  isFrozen: boolean,
): {
  enabled: boolean;
  retry: number;
  refetchInterval: number;
  queryKey: readonly [WalletConfig["chain"], string, number, "l1State"];
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
 * @remarks The stateId is the identity of this fetch's sampled state, so every fetch
 * gets a new preview (decisions amendment 38). The builder closes over the current
 * wallet config, SDK, client, and signer supplied by the UI.
 */
export async function getL1State(walletConfig: WalletConfig): Promise<L1StateType> {
  const sdkState = await walletConfig.sdk.getL1AccountState(
    walletConfig.cccClient,
    walletConfig.accountLocks,
  );
  const { system, user, account } = sdkState;
  // Fulfilled orders and orders the market will never fill are collected on the next
  // transaction, which melts the latter and returns their funds; live fillable orders stay
  // on the book (decisions amendment 52(z)).
  const collectable = (group: (typeof user.orders)[number]): boolean =>
    group.order.isFulfilled() || isRefused(group, system);
  const { projection, context: conversionContext } = projectConversionTransactionContext(
    system,
    account,
    {
      available: user.orders.filter(collectable),
      pending: user.orders.filter((group) => !collectable(group)),
    },
  );
  const { ckbNative, ickbNative, ckbBalance, ickbBalance, ckbAvailable, ickbAvailable } =
    projection;

  const txContext: TransactionContext = conversionContext;

  return {
    ckbNative,
    ickbNative,
    ckbBalance,
    ickbBalance,
    ckbAvailable,
    ickbAvailable,
    tipTimestamp: system.tip.timestamp,
    system,
    stateId: String(objectIdentityKey(sdkState)),
    txBuilder: async (isCkb2Udt, amount, destination) =>
      buildTransactionPreview(txContext, isCkb2Udt, amount, destination, walletConfig),
    hasCollectable:
      conversionContext.availableOrders.length > 0 ||
      conversionContext.receipts.length > 0 ||
      conversionContext.readyWithdrawals.length > 0,
  };
}
