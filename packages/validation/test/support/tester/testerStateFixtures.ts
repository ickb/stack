import { ccc } from "@ckb-ccc/core";
import { Ratio, type OrderGroup } from "@ickb/order";
import { headerLike } from "@ickb/testkit";
import type { TesterState } from "../../../src/tester/runtime/runtime.ts";

const testerClient = new ccc.ClientPublicTestnet({
  url: "https://example.invalid",
});
export const testerSigner = new ccc.SignerCkbPrivateKey(
  testerClient,
  `0x${"11".repeat(32)}`,
);
export function testerState(values: {
  availableCkbBalance: bigint;
  pendingCkbBalance?: bigint;
  totalCkbBalance?: bigint;
  plainCkbBalance?: bigint;
  availableIckbBalance?: bigint;
  pendingIckbBalance?: bigint;
  totalIckbBalance?: bigint;
  exchangeRatio?: TesterState["system"]["exchangeRatio"];
  feeRate?: bigint;
  capacityCells?: ccc.Cell[];
  userOrders?: OrderGroup[];
}): TesterState {
  const availableIckbBalance = values.availableIckbBalance ?? 0n;
  const pendingCkbBalance = values.pendingCkbBalance ?? 0n;
  const pendingIckbBalance = values.pendingIckbBalance ?? 0n;
  const exchangeRatio =
    values.exchangeRatio ?? Ratio.from({ ckbScale: 1n, udtScale: 1n });
  const feeRate = values.feeRate ?? 1000n;
  return {
    system: {
      exchangeRatio,
      feeRate,
      tip: headerLike({ timestamp: 0n }),
      orderPool: [],
      ckbAvailable: values.availableCkbBalance,
      ckbMaturing: [],
      poolDeposits: { deposits: [], id: "tester-pool-fixture" },
    },
    account: {
      capacityCells: values.capacityCells ?? [],
      nativeUdtCells: [],
      nativeUdtCapacity: 0n,
      nativeUdtBalance: 0n,
      receipts: [],
      withdrawalGroups: [],
    },
    userOrders: values.userOrders ?? [],
    conversionContext: {
      system: {
        exchangeRatio,
        feeRate,
        tip: headerLike({ timestamp: 0n }),
        orderPool: [],
        ckbAvailable: values.availableCkbBalance,
        ckbMaturing: [],
        poolDeposits: { deposits: [], id: "tester-context-pool-fixture" },
      },
      receipts: [],
      readyWithdrawals: [],
      availableOrders: [],
      ckbAvailable: values.availableCkbBalance,
      ickbAvailable: availableIckbBalance,
      estimatedMaturity: 0n,
    },
    availableCkbBalance: values.availableCkbBalance,
    pendingCkbBalance,
    totalCkbBalance:
      values.totalCkbBalance ?? values.availableCkbBalance + pendingCkbBalance,
    plainCkbBalance: values.plainCkbBalance ?? values.availableCkbBalance,
    availableIckbBalance,
    pendingIckbBalance,
    totalIckbBalance:
      values.totalIckbBalance ?? availableIckbBalance + pendingIckbBalance,
  };
}
