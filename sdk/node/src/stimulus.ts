import { ccc } from "@ckb-ccc/core";
import { getConfig } from "../../src/constants.ts";
import { IckbSdk } from "../../src/sdk.ts";
import { signerAccountLocks } from "../../src/send/account_locks.ts";
import { createPublicClient, verifyChainPreflight } from "./shared/chain.ts";
import { logExecution } from "./shared/logging.ts";
import { readStimulusConfig, readStimulusOverride } from "./stimulus/config.ts";
import { runStimulusTurn } from "./stimulus/turn.ts";
// One process is one stimulus turn: read config, connect, send at most one transaction, exit.
if (process.argv.length > 2) {
  throw new Error(`Unknown argument: ${String(process.argv[2])}`);
}
const { chain, privateKey, rpcUrl, rpcEndpoint } = await readStimulusConfig(process.env);
const override = readStimulusOverride(process.env);
const startTime = new Date();
let clientOwner: ccc.Owner<ccc.Client> | undefined;
try {
  clientOwner = createPublicClient(chain, rpcUrl);
  const client = clientOwner.value;
  const preflight = await verifyChainPreflight(client, chain);
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const address = await signer.getRecommendedAddressObj();
  const primaryLock = address.script;
  await runStimulusTurn({
    runtime: {
      client,
      signer,
      sdk: IckbSdk.fromChain(chain),
      order: getConfig(chain).order,
      primaryLock,
      accountLocks: await signerAccountLocks(signer, primaryLock),
    },
    identity: {
      chain: "testnet",
      address: address.toString(),
      primaryLock: {
        codeHash: primaryLock.codeHash,
        hashType: primaryLock.hashType,
        args: primaryLock.args,
      },
      rpcEndpoint,
      preflight: {
        expected: preflight.expected,
        observed: preflight.observed,
        matches: preflight.matches,
      },
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
// The disposed client leaves nothing on the event loop, so the turn ends here on its own.
process.exitCode ??= 0;
