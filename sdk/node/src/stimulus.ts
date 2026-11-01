import type { ccc } from "@ckb-ccc/core";
import { getConfig } from "../../src/constants.ts";
import { IckbSdk } from "../../src/sdk.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { logExecution } from "./shared/logging.ts";
import { keyAccount } from "./shared/signer.ts";
import { readStimulusConfig, readStimulusOverride } from "./stimulus/config.ts";
import { runStimulusTurn } from "./stimulus/turn.ts";
// One process is one stimulus turn: read config, connect, send at most one transaction, exit.
const { chain, privateKeys, rpcUrls, rpcEndpoints } = await readStimulusConfig(
  process.env,
);
const override = readStimulusOverride(process.env);
const startTime = new Date();
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrls);
  const client = clientOwner.value;
  await verifyChainPreflight(client, chain);
  const { signer, address, primaryLock, accountLocks } = await keyAccount(
    client,
    privateKeys,
  );
  const managers = getConfig(chain);
  await runStimulusTurn({
    runtime: {
      client,
      signer,
      sdk: new IckbSdk(managers),
      order: managers.order,
      primaryLock,
      accountLocks,
    },
    identity: {
      chain: "testnet",
      address,
      primaryLock,
      rpcEndpoints,
    },
    override,
    random: Math.random,
  });
} catch (error) {
  // Connection and preflight failures get the same log line and exit code as turn failures.
  logExecution("stimulus.turn", { outcome: "failed", error }, startTime);
  process.exitCode = 1;
} finally {
  // Closes the sockets the client opened, so nothing keeps the finished turn alive.
  await clientOwner?.dispose();
}
