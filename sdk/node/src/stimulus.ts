import { ccc } from "@ckb-ccc/core";
import { signerAccountLocks } from "../../src/conversion/account_locks.ts";
import { IckbSdk } from "../../src/sdk.ts";
import {
  createPublicClient,
  logExecution,
  publicRpcEndpointIdentity,
  verifyChainPreflight,
} from "./shared/index.ts";
import {
  readStimulusConfig,
  readStimulusOverride,
  runStimulusTurn,
} from "./stimulus/index.ts";
// One process is one stimulus turn: read config, connect, send at most one transaction, exit.
if (process.argv.length > 2) {
  throw new Error(`Unknown argument: ${String(process.argv[2])}`);
}
const { chain, privateKey, rpcUrl } = await readStimulusConfig(process.env);
const override = readStimulusOverride(process.env);
const startTime = new Date();
try {
  const client = createPublicClient(chain, rpcUrl);
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
      rpcEndpoint: publicRpcEndpointIdentity(rpcUrl),
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
}
process.exitCode ??= 0;
// CCC's fetch transport leaves its 30 s abort timer armed after a failed request, which would keep
// this finished turn alive. Pipes and sockets are asynchronous on POSIX, so exit only once both
// output streams have drained; a bare process.exit() truncates pending output.
await Promise.all(
  [process.stdout, process.stderr].map(
    async (stream) =>
      new Promise<void>((resolve) => {
        stream.write("", () => {
          resolve();
        });
      }),
  ),
);
// eslint-disable-next-line unicorn/no-process-exit -- The turn is over and its output is flushed.
process.exit();
