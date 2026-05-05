import { ccc } from "@ckb-ccc/ccc";
import type { WithdrawalGroup } from "@ickb/core";
import { type OrderGroup } from "@ickb/order";
import { type SystemState } from "@ickb/sdk";
import { collect, sum } from "@ickb/utils";
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
  const [accountCells, receipts, withdrawalGroups] = await Promise.all([
    getAccountCells(walletConfig),
    collect(
      walletConfig.managers.logic.findReceipts(
        walletConfig.cccClient,
        walletConfig.accountLocks,
        { onChain: true },
      ),
    ),
    collect(
      walletConfig.managers.ownedOwner.findWithdrawalGroups(
        walletConfig.cccClient,
        walletConfig.accountLocks,
        { onChain: true, tip: system.tip },
      ),
    ),
  ]);

  const capacityCells = accountCells.filter((cell) => cell.cellOutput.type === undefined);
  const udtCells = accountCells.filter((cell) =>
    walletConfig.managers.ickbUdt.isUdt(cell),
  );
  const nativeUdtInfo = await walletConfig.managers.ickbUdt.infoFrom(
    walletConfig.cccClient,
    udtCells,
  );

  const ckbNative =
    sum(0n, ...capacityCells.map((cell) => cell.cellOutput.capacity)) +
    nativeUdtInfo.capacity;
  const ickbNative = nativeUdtInfo.balance;

  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of withdrawalGroups) {
    if (group.owned.isReady) {
      readyWithdrawals.push(group);
    } else {
      pendingWithdrawals.push(group);
    }
  }

  const availableOrders: OrderGroup[] = [];
  const pendingOrders: OrderGroup[] = [];
  for (const group of user.orders) {
    if (group.order.isDualRatio() || !group.order.isMatchable()) {
      availableOrders.push(group);
    } else {
      pendingOrders.push(group);
    }
  }

  const ckbAvailable =
    ckbNative +
    sumCkb(receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  const ickbAvailable =
    ickbNative +
    sumUdt(receipts) +
    sumUdt(readyWithdrawals) +
    sumUdt(availableOrders);

  const ckbBalance = ckbAvailable + sumCkb(pendingWithdrawals) + sumCkb(pendingOrders);
  const ickbBalance = ickbAvailable + sumUdt(pendingWithdrawals) + sumUdt(pendingOrders);

  const estimatedMaturity = [
    system.tip.timestamp,
    ...pendingWithdrawals.map((group) => group.owned.maturity.toUnix(system.tip)),
    ...pendingOrders
      .map((group) => group.order.maturity)
      .filter((maturity): maturity is bigint => maturity !== undefined),
  ].reduce((best, maturity) => (best > maturity ? best : maturity));

  const txContext: TransactionContext = {
    system,
    receipts,
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
      String(receipts.length),
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

async function getAccountCells(walletConfig: WalletConfig): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];

  for (const lock of walletConfig.accountLocks) {
    for await (const cell of walletConfig.cccClient.findCellsOnChain(
      {
        script: lock,
        scriptType: "lock",
        scriptSearchMode: "exact",
        withData: true,
      },
      "asc",
      400,
    )) {
      if (!cell.cellOutput.lock.eq(lock)) {
        continue;
      }

      cells.push(cell);
    }
  }

  return cells;
}

function sumCkb(items: { ckbValue: bigint }[]): bigint {
  return sum(0n, ...items.map((item) => item.ckbValue));
}

function sumUdt(items: { udtValue: bigint }[]): bigint {
  return sum(0n, ...items.map((item) => item.udtValue));
}
