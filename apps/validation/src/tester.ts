import { ccc } from "@ckb-ccc/core";
import {
  createPublicClient,
  logExecution,
  signerAccountLocks,
  verifyChainPreflight,
} from "@ickb/node-utils";
import { getConfig, IckbSdk } from "@ickb/sdk";
import {
  handleTesterAttemptError,
  readTesterFeePolicy,
  readTesterRuntimeConfig,
  readTesterScenario,
  runTesterTurn,
  type Runtime,
} from "@ickb/validation";

// One process is one tester turn: read config, connect, place at most one order, exit.
if (process.argv.length > 2) {
  throw new Error(`Unknown argument: ${String(process.argv[2])}`);
}
const { chain, privateKey, rpcUrl } = await readTesterRuntimeConfig(process.env);
const testerScenario = readTesterScenario(process.env);
const feePolicy = readTesterFeePolicy(process.env);
try {
  const client = createPublicClient(chain, rpcUrl);
  await verifyChainPreflight(client, chain);
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: secret purpose boundary.
  // - INVARIANT: private keys pass only to signer construction and signing.
  // - FAILURE MODE: passing keys to logs, errors, telemetry, redaction, masking, or test hooks leaks signing authority.
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
  const runtime: Runtime = {
    client,
    signer,
    sdk: IckbSdk.fromConfig(getConfig(chain)),
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
  };
  await runTesterTurn({ runtime, testerScenario, feePolicy });
} catch (error) {
  // Connection and preflight failures get the same log line and exit code as attempt failures.
  const executionLog = {};
  handleTesterAttemptError(error, executionLog);
  logExecution(executionLog, new Date());
}
process.exitCode ??= 0;
// CCC's fetch transport leaves its 30 s abort timer armed after a failed request, which would keep
// this finished turn alive. Pipes and sockets are asynchronous on POSIX, so exit only once stdout
// has drained; a bare process.exit() truncates the event stream under load.
process.stdout.write("", () => {
  // eslint-disable-next-line unicorn/no-process-exit -- The turn is over and its output is flushed.
  process.exit();
});
