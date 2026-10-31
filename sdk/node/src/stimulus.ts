import { ccc } from "@ckb-ccc/core";
import { getConfig } from "../../src/constants.ts";
import { IckbSdk } from "../../src/sdk.ts";
import { signerAccountLocks } from "../../src/send/sign_and_send_transaction.ts";
import { SignerCombined } from "../../src/utils/signer.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { logExecution } from "./shared/logging.ts";
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
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new SignerCombined(
    privateKeys.map((key) => new ccc.SignerCkbPrivateKey(client, key)),
  );
  const address = await signer.getRecommendedAddressObj();
  const primaryLock = address.script;
  const managers = getConfig(chain);
  await runStimulusTurn({
    runtime: {
      client,
      signer,
      sdk: new IckbSdk(managers),
      order: managers.order,
      primaryLock,
      accountLocks: await signerAccountLocks(signer, primaryLock),
    },
    identity: {
      chain: "testnet",
      address: address.toString(),
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
