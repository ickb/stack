import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { IckbSdk, getConfig, sendAndWaitForCommit } from "@ickb/sdk";
import {
  createPublicClient,
  formatCkb,
  handleLoopError,
  logExecution,
  parseMaxIterations,
  parseOptionalRpcUrl,
  parseSleepInterval,
  parseSupportedChain,
  readPrivateKeyEnv,
  readRuntimeConfigEnv,
  reachedMaxIterations,
  signerAccountLocks,
  sleep,
  type SupportedChain,
} from "@ickb/node-utils";
import { pathToFileURL } from "node:url";
import {
  buildTransaction,
  readTesterState,
  type Runtime,
} from "./runtime.js";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";
const CKB = ccc.fixedPointFrom(1);
const CKB_RESERVE = 2000n * CKB;
const MIN_POST_TX_CKB = 1000n * CKB;
const MIN_TOTAL_CAPITAL_DIVISOR = 20n;
const TESTER_FEE = 100n;
const TESTER_FEE_BASE = 100000n;
const RANDOM_SCALE = 1000000n;

type TesterRuntimeConfig = {
  chain: SupportedChain;
  privateKey: `0x${string}`;
  rpcUrl: string | undefined;
  sleepIntervalMs: number;
  maxIterations: number | undefined;
};

async function main(): Promise<void> {
  const { chain, privateKey, rpcUrl, sleepIntervalMs, maxIterations } =
    await readTesterRuntimeConfig(process.env);
  const client = createPublicClient(chain, rpcUrl);
  const config = getConfig(chain);
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const recommendedAddress = await signer.getRecommendedAddressObj();
  const primaryLock = recommendedAddress.script;
  const runtime: Runtime = {
    client,
    signer,
    sdk: IckbSdk.fromConfig(config),
    primaryLock,
    accountLocks: await signerAccountLocks(signer, primaryLock),
  };

  let stopAfterLog = false;
  let completedIterations = 0;
  for (;;) {
    await sleep(2 * Math.random() * sleepIntervalMs);

    const executionLog: Record<string, unknown> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readTesterState(runtime);
      const skip = await freshMatchableOrderSkip(
        runtime,
        state.userOrders,
        state.system.tip,
      );
      if (skip) {
        executionLog.skip = skip;
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, state.system.tip);
      const totalEquivalentCkb =
        state.availableCkbBalance +
        convert(false, state.availableIckbBalance, state.system.tip);

      executionLog.balance = {
        CKB: {
          total: formatCkb(state.availableCkbBalance),
          available: formatCkb(state.availableCkbBalance),
          unavailable: formatCkb(0n),
        },
        ICKB: {
          total: formatCkb(state.availableIckbBalance),
          available: formatCkb(state.availableIckbBalance),
          unavailable: formatCkb(0n),
        },
        totalEquivalent: {
          CKB: formatCkb(totalEquivalentCkb),
          ICKB: formatCkb(
            convert(true, state.availableCkbBalance, state.system.tip) +
              state.availableIckbBalance,
          ),
        },
      };
      executionLog.ratio = state.system.exchangeRatio;

      const ickbEquivalentBalance = convert(
        true,
        state.availableCkbBalance,
        state.system.tip,
      );
      const totalIckbBalance = ickbEquivalentBalance + state.availableIckbBalance;
      const isCkb2Udt =
        sampleRatio(totalIckbBalance) <= ickbEquivalentBalance;

      const ckbAmount = isCkb2Udt
        ? min(
            sampleRatio(depositCapacity),
            state.availableCkbBalance - CKB_RESERVE,
          )
        : 0n;
      const udtAmount = isCkb2Udt
        ? 0n
        : min(
            sampleRatio(ICKB_DEPOSIT_CAP),
            state.availableIckbBalance,
          );

      if (ckbAmount <= 0n && udtAmount <= 0n) {
        if (totalEquivalentCkb < depositCapacity / MIN_TOTAL_CAPITAL_DIVISOR) {
          executionLog.error =
            "Not enough funds to continue testing, shutting down...";
          logExecution(executionLog, startTime);
          return;
        }
        executionLog.skip = { reason: "sampled-amount-too-small" };
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      const amounts = isCkb2Udt
        ? { ckbValue: ckbAmount, udtValue: 0n }
        : { ckbValue: 0n, udtValue: udtAmount };
      const estimate = IckbSdk.estimate(isCkb2Udt, amounts, state.system, {
        fee: TESTER_FEE,
        feeBase: TESTER_FEE_BASE,
      });
      if (estimate.convertedAmount <= 0n) {
        executionLog.skip = { reason: "estimated-conversion-too-small" };
        if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
          return;
        }
        continue;
      }

      if (isCkb2Udt && state.availableCkbBalance - ckbAmount < MIN_POST_TX_CKB) {
        throw new Error("Not enough CKB, less than 1000 CKB after the tx");
      }

      const tx = await buildTransaction(runtime, state, amounts, estimate.info);

      executionLog.actions = {
        newOrder: isCkb2Udt
          ? {
              giveCkb: formatCkb(ckbAmount),
              takeIckb: formatCkb(estimate.convertedAmount),
              fee: formatCkb(estimate.ckbFee),
            }
          : {
              giveIckb: formatCkb(udtAmount),
              takeCkb: formatCkb(estimate.convertedAmount),
              fee: formatCkb(estimate.ckbFee),
            },
        cancelledOrders: state.userOrders.filter((group) => group.order.isMatchable())
          .length,
      };
      executionLog.txFee = {
        fee: formatCkb(await tx.getFee(runtime.client)),
        feeRate: state.system.feeRate,
      };
      executionLog.txHash = await sendAndWaitForCommit(runtime, tx, {
        onSent: (txHash) => {
          executionLog.txHash = txHash;
        },
      });
    } catch (e) {
      stopAfterLog = handleLoopError(executionLog, e);
    }
    if (stopAfterLog) {
      logExecution(executionLog, startTime);
      return;
    }
    if (logTerminalIteration(executionLog, startTime, ++completedIterations, maxIterations)) {
      return;
    }
  }
}

function logTerminalIteration(
  executionLog: Record<string, unknown>,
  startTime: Date,
  completedIterations: number,
  maxIterations: number | undefined,
): boolean {
  logExecution(executionLog, startTime);
  return reachedMaxIterations(completedIterations, maxIterations);
}

export async function readTesterRuntimeConfig(env: NodeJS.ProcessEnv): Promise<TesterRuntimeConfig> {
  const {
    CHAIN,
    RPC_URL,
    TESTER_CONFIG_FILE,
    TESTER_PRIVATE_KEY,
    TESTER_PRIVATE_KEY_FILE,
    TESTER_SLEEP_INTERVAL,
    MAX_ITERATIONS,
  } = env;
  if (TESTER_CONFIG_FILE !== undefined && TESTER_CONFIG_FILE !== "") {
    for (const name of [
      "CHAIN",
      "RPC_URL",
      "TESTER_PRIVATE_KEY",
      "TESTER_PRIVATE_KEY_FILE",
      "TESTER_SLEEP_INTERVAL",
      "MAX_ITERATIONS",
    ]) {
      if (env[name] !== undefined && env[name] !== "") {
        throw new Error(`Set only one of TESTER_CONFIG_FILE or ${name}`);
      }
    }

    return readRuntimeConfigEnv(TESTER_CONFIG_FILE, "TESTER_CONFIG_FILE");
  }

  if (!CHAIN) {
    throw new Error("Invalid env CHAIN: Empty");
  }
  const privateKey = await readPrivateKeyEnv(
    TESTER_PRIVATE_KEY,
    "TESTER_PRIVATE_KEY",
    TESTER_PRIVATE_KEY_FILE,
    "TESTER_PRIVATE_KEY_FILE",
  );
  return {
    chain: parseSupportedChain(CHAIN, "CHAIN"),
    privateKey,
    rpcUrl: parseOptionalRpcUrl(RPC_URL, "RPC_URL"),
    sleepIntervalMs: parseSleepInterval(TESTER_SLEEP_INTERVAL, "TESTER_SLEEP_INTERVAL"),
    maxIterations: parseMaxIterations(MAX_ITERATIONS, "MAX_ITERATIONS"),
  };
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function sampleRatio(amount: bigint): bigint {
  if (amount <= 0n) {
    return 0n;
  }

  return (amount * randomScaled()) / RANDOM_SCALE;
}

function randomScaled(): bigint {
  return BigInt(Math.floor(Math.random() * Number(RANDOM_SCALE)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
