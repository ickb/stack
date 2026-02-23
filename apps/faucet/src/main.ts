import { ccc } from "@ckb-ccc/core";
import { sum, unique } from "@ickb/utils";
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
  const key = ccc.hexFrom(getRandomValues(new Uint8Array(32)));
  console.log(key);
  console.log();

  const dummyAccount = new ccc.SignerCkbPrivateKey(client, key);
  const dummyAddress = await dummyAccount.getRecommendedAddressObj();
  console.log("Use this dummy testnet account for requesting Faucet funds:");
  console.log(dummyAddress.toString());
  console.log();

  for (;;) {
    await new Promise((r) => {
      setTimeout(r, 120000);
    });
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
      const capacities: ccc.Cell[] = [];
      for (const lock of unique([dummyAddress.script])) {
        for await (const cell of client.findCellsOnChain(
          {
            script: lock,
            scriptType: "lock",
            filter: {
              scriptLenRange: [0n, 1n],
              outputDataLenRange: [0n, 1n],
            },
            scriptSearchMode: "exact",
            withData: true,
          },
          "asc",
          400,
        )) {
          if (
            cell.cellOutput.type !== undefined ||
            !cell.cellOutput.lock.eq(lock)
          ) {
            continue;
          }
          capacities.push(cell);
        }
      }

      if (capacities.length === 0) {
        console.log("No faucet funds to transfer, shutting down...");
        exit(0);
      }

      const ckbBalance = sum(
        0n,
        ...capacities.map((c) => c.cellOutput.capacity),
      );

      executionLog.balance = {
        CKB: ccc.fixedPointToString(ckbBalance),
      };

      const tx = ccc.Transaction.default();
      for (const cell of capacities) {
        tx.addInput(cell);
      }
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
