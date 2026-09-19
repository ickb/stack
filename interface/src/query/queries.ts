import {
  ickbExchangeRatio,
  isRefused,
  projectConversionTransactionContext,
  Ratio,
  type AccountAvailabilityProjection,
  type SystemState,
} from "@ickb/sdk";
import { skipToken, type SkipToken } from "@tanstack/react-query";
import type { Destination } from "../action/destination.ts";
import { buildTransactionPreview } from "../action/transaction.ts";
import type { RootConfig, TxInfo, WalletConfig } from "../shared/utils.ts";
import { l1StateQueryKey } from "./l1StateQueryKey.ts";
import { objectIdentityKey, rootConfigQueryKey } from "./rootConfigQueryKey.ts";

export interface L1StateType {
  projection: AccountAvailabilityProjection;
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
  tipTimestamp: bigint;
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
 * @remarks The query key is rooted in the root config key, including the client object
 * identity used to read the tip header. Without a config (an unsupported chain) the query
 * is parked, its key tolerating the missing config.
 */
export function quoteStateOptions(rootConfig: RootConfig | undefined): {
  retry: number;
  refetchInterval: number;
  queryKey: readonly [
    ...(readonly [RootConfig["chain"], number, "rootConfig"] | readonly ["unsupported"]),
    "quoteState",
  ];
  queryFn: (() => Promise<QuoteState>) | SkipToken;
} {
  return {
    retry: 2,
    refetchInterval: 60_000,
    queryKey: [
      ...(rootConfig === undefined
        ? (["unsupported"] as const)
        : rootConfigQueryKey(rootConfig)),
      "quoteState",
    ],
    queryFn:
      rootConfig === undefined
        ? skipToken
        : async (): Promise<QuoteState> => {
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
  const { projection, context } = projectConversionTransactionContext(system, account, {
    available: user.orders.filter(collectable),
    pending: user.orders.filter((group) => !collectable(group)),
  });

  return {
    projection,
    system,
    stateId: String(objectIdentityKey(sdkState)),
    txBuilder: async (isCkb2Udt, amount, destination) =>
      buildTransactionPreview(context, isCkb2Udt, amount, destination, walletConfig),
    hasCollectable:
      context.availableOrders.length > 0 ||
      context.receipts.length > 0 ||
      context.readyWithdrawals.length > 0,
  };
}
