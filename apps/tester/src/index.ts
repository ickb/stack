import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { IckbSdk, getConfig, sendAndWaitForCommit } from "@ickb/sdk";
import { type OrderGroup } from "@ickb/order";
import { pathToFileURL } from "node:url";
import { buildTransaction, readTesterState, type Runtime } from "./runtime.js";

const CKB = ccc.fixedPointFrom(1);
const CKB_RESERVE = 2000n * CKB;
const MIN_POST_TX_CKB = 1000n * CKB;
const MIN_TOTAL_CAPITAL_DIVISOR = 20n;
const TESTER_FEE = 100n;
const TESTER_FEE_BASE = 100000n;
const MAX_ELAPSED_BLOCKS = 100800n;
const RANDOM_SCALE = 1000000n;

type SupportedChain = "mainnet" | "testnet";

async function main(): Promise<void> {
  const { CHAIN, RPC_URL, TESTER_PRIVATE_KEY, TESTER_SLEEP_INTERVAL } =
    process.env;
  if (!CHAIN) {
    throw new Error("Invalid env CHAIN: Empty");
  }
  if (!TESTER_PRIVATE_KEY) {
    throw new Error("Empty env TESTER_PRIVATE_KEY");
  }
  const sleepInterval = parseSleepInterval(
    TESTER_SLEEP_INTERVAL,
    "TESTER_SLEEP_INTERVAL",
  );

  const chain = parseChain(CHAIN);
  const client = createClient(chain, RPC_URL);
  const config = getConfig(chain);
  const signer = new ccc.SignerCkbPrivateKey(client, TESTER_PRIVATE_KEY);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
  const runtime: Runtime = {
    client,
    signer,
    sdk: IckbSdk.fromConfig(config),
    primaryLock,
    accountLocks: dedupeScripts(
      (await signer.getAddressObjs()).map(({ script }) => script),
    ),
  };

  for (;;) {
    await sleep(2 * Math.random() * sleepInterval);

    const executionLog: Record<string, unknown> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readTesterState(runtime);
      if (await hasFreshMatchableOrders(runtime, state.userOrders, state.system.tip)) {
        continue;
      }

      const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, state.system.tip);
      const totalEquivalentCkb =
        state.availableCkbBalance +
        convert(false, state.availableIckbBalance, state.system.tip);

      executionLog.balance = {
        CKB: {
          total: fmtCkb(state.availableCkbBalance),
          available: fmtCkb(state.availableCkbBalance),
          unavailable: fmtCkb(0n),
        },
        ICKB: {
          total: fmtCkb(state.availableIckbBalance),
          available: fmtCkb(state.availableIckbBalance),
          unavailable: fmtCkb(0n),
        },
        totalEquivalent: {
          CKB: fmtCkb(totalEquivalentCkb),
          ICKB: fmtCkb(
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
          console.log(JSON.stringify(executionLog, replacer, " "));
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
        continue;
      }

      if (isCkb2Udt && state.availableCkbBalance - ckbAmount < MIN_POST_TX_CKB) {
        throw new Error("Not enough CKB, less than 1000 CKB after the tx");
      }

      const tx = await buildTransaction(runtime, state, amounts, estimate.info);

      executionLog.actions = {
        newOrder: isCkb2Udt
          ? {
              giveCkb: fmtCkb(ckbAmount),
              takeIckb: fmtCkb(estimate.convertedAmount),
              fee: fmtCkb(estimate.ckbFee),
            }
          : {
              giveIckb: fmtCkb(udtAmount),
              takeCkb: fmtCkb(estimate.convertedAmount),
              fee: fmtCkb(estimate.ckbFee),
            },
        cancelledOrders: state.userOrders.filter((group) => group.order.isMatchable())
          .length,
      };
      executionLog.txFee = {
        fee: fmtCkb(await tx.getFee(runtime.client)),
        feeRate: state.system.feeRate,
      };
      executionLog.txHash = await sendAndWaitForCommit(runtime, tx);
    } catch (e) {
      executionLog.error = errorToLog(e);
    }
    executionLog.ElapsedSeconds = Math.round(
      (new Date().getTime() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, replacer, " "));
  }
}

export function parseSleepInterval(
  intervalSeconds: string | undefined,
  envName: string,
): number {
  const seconds = Number(intervalSeconds);
  if (intervalSeconds === undefined || !Number.isFinite(seconds) || seconds < 1) {
    throw new Error("Invalid env " + envName);
  }

  return seconds * 1000;
}

async function hasFreshMatchableOrders(
  runtime: Runtime,
  orders: OrderGroup[],
  tip: ccc.ClientBlockHeader,
): Promise<boolean> {
  const tx2BlockNumber = new Map<string, bigint>();

  for (const group of orders) {
    if (!group.order.isMatchable()) {
      continue;
    }

    const txHash = group.order.cell.outPoint.txHash;
    let blockNumber = tx2BlockNumber.get(txHash);
    if (blockNumber === undefined) {
      const tx = await runtime.client.getTransaction(txHash);
      if (!tx?.blockNumber) {
        return true;
      }

      blockNumber = tx.blockNumber;
      tx2BlockNumber.set(txHash, blockNumber);
    }

    if (blockNumber + MAX_ELAPSED_BLOCKS >= tip.number) {
      return true;
    }
  }

  return false;
}

function createClient(chain: SupportedChain, rpcUrl: string | undefined): ccc.Client {
  const config = rpcUrl ? { url: rpcUrl } : undefined;
  return chain === "mainnet"
    ? new ccc.ClientPublicMainnet(config)
    : new ccc.ClientPublicTestnet(config);
}

function parseChain(chain: string): SupportedChain {
  if (chain === "mainnet" || chain === "testnet") {
    return chain;
  }

  throw new Error("Invalid env CHAIN: " + chain);
}

function dedupeScripts(scripts: ccc.Script[]): ccc.Script[] {
  const seen = new Set<string>();
  const unique: ccc.Script[] = [];

  for (const script of scripts) {
    const key = script.toHex();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(script);
  }

  return unique;
}

function fmtCkb(balance: bigint): number {
  return Number(balance) / Number(CKB);
}

function replacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

function errorToLog(error: unknown): unknown {
  if (error instanceof Object && "stack" in error) {
    return {
      name: "name" in error ? error.name : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "Unknown error",
      stack: error.stack ?? "",
    };
  }

  return error ?? "Empty Error";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
