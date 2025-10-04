import { ccc } from "@ckb-ccc/core";
import {
  CapacityManager,
  collect,
  hexFrom,
  SmartTransaction,
  sum,
} from "@ickb/utils";
import { getRandomValues } from "crypto";
import { exit } from "process";

export async function main(): Promise<void> {
  const { ADDRESS } = process.env;
  if (!ADDRESS) {
    console.error("Empty env ADDRESS");
    exit(1);
  }

  console.log("Your testnet account:");
  console.log(ADDRESS);
  console.log();
  const client = new ccc.ClientPublicTestnet();
  const realAccount = await ccc.Address.fromString(ADDRESS, client);

  console.log("Generating temporary key:");
  const key = hexFrom(getRandomValues(new Uint8Array(32)));
  console.log(key);
  console.log();

  const dummyAccount = new ccc.SignerCkbPrivateKey(client, key);
  const dummyAddress = await dummyAccount.getRecommendedAddressObj();
  console.log("Use this dummy testnet account for requesting Faucet funds:");
  console.log(dummyAddress.toString());
  console.log();

  const capacityManager = CapacityManager.withEmptyData();

  for (;;) {
    await new Promise((r) => setTimeout(r, 120000));
    console.log();

    const executionLog: {
      startTime?: string;
      balance?: {
        CKB?: string;
      };
      error?: string | object;
      txHash?: string;
      elapsedSeconds?: number;
    } = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();
    try {
      const capacities = await collect(
        capacityManager.findCapacities(client, [dummyAddress.script]),
      );

      if (capacities.length === 0) {
        console.log("No faucet funds to transfer, shutting down...");
        exit(0);
      }

      const ckbBalance = sum(0n, ...capacities.map((c) => c.ckbValue));

      executionLog.balance = {
        CKB: ccc.fixedPointToString(ckbBalance),
      };

      const tx = SmartTransaction.default();
      capacityManager.addCapacities(tx, capacities);
      await tx.completeFeeChangeToLock(dummyAccount, realAccount.script);
      executionLog.txHash = await dummyAccount.sendTransaction(tx);
    } catch (e) {
      if (e instanceof Object && "stack" in e) {
        /* eslint-disable-next-line @typescript-eslint/no-misused-spread */
        executionLog.error = { ...e, stack: e.stack ?? "" };
      } else {
        executionLog.error = e ?? "Empty Error";
      }
    }
    executionLog.elapsedSeconds = Math.round(
      (new Date().getTime() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, undefined, " "));
  }
}
