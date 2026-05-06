import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, convert } from "@ickb/core";
import { IckbSdk, getConfig, type SystemState } from "@ickb/sdk";
import { type OrderGroup } from "@ickb/order";

const CKB = ccc.fixedPointFrom(1);
const CKB_RESERVE = 2000n * CKB;
const MIN_POST_TX_CKB = 1000n * CKB;
const MIN_TOTAL_CAPITAL_DIVISOR = 20n;
const TESTER_FEE = 100n;
const TESTER_FEE_BASE = 100000n;
const MAX_ELAPSED_BLOCKS = 100800n;
const FIND_CELLS_PAGE_SIZE = 400;
const RANDOM_SCALE = 1000000n;

interface Runtime {
  chain: SupportedChain;
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  managers: ReturnType<typeof getConfig>["managers"];
  primaryLock: ccc.Script;
  accountLocks: ccc.Script[];
}

interface TesterState {
  system: SystemState;
  userOrders: OrderGroup[];
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
}

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
  if (!TESTER_SLEEP_INTERVAL || Number(TESTER_SLEEP_INTERVAL) < 1) {
    throw new Error("Invalid env TESTER_SLEEP_INTERVAL");
  }

  const chain = parseChain(CHAIN);
  const client = createClient(chain, RPC_URL);
  const { managers, bots } = getConfig(chain);
  const signer = new ccc.SignerCkbPrivateKey(client, TESTER_PRIVATE_KEY);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
  const runtime: Runtime = {
    chain,
    client,
    signer,
    sdk: new IckbSdk(
      managers.ownedOwner,
      managers.logic,
      managers.order,
      bots,
    ),
    managers,
    primaryLock,
    accountLocks: dedupeScripts(
      (await signer.getAddressObjs()).map(({ script }) => script),
    ),
  };
  const sleepInterval = Number(TESTER_SLEEP_INTERVAL) * 1000;

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

      const depositAmount = convert(false, ICKB_DEPOSIT_CAP, state.system.tip);
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
            sampleRatio(depositAmount),
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
        if (totalEquivalentCkb < depositAmount / MIN_TOTAL_CAPITAL_DIVISOR) {
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
      executionLog.txHash = await runtime.signer.sendTransaction(tx);
    } catch (e) {
      executionLog.error = errorToLog(e);
    }
    executionLog.ElapsedSeconds = Math.round(
      (new Date().getTime() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, replacer, " "));
  }
}

async function readTesterState(runtime: Runtime): Promise<TesterState> {
  const [{ system, user }, capacityCells, udtCells] = await Promise.all([
    runtime.sdk.getL1State(runtime.client, runtime.accountLocks),
    collectCapacityCells(runtime.signer),
    collectWalletUdtCells(runtime.signer, runtime.managers.ickbUdt),
  ]);
  const walletUdtInfo = await runtime.managers.ickbUdt.infoFrom(
    runtime.client,
    udtCells,
  );

  return {
    system,
    userOrders: user.orders,
    availableCkbBalance:
      sumValues(capacityCells, (cell) => cell.cellOutput.capacity) +
      walletUdtInfo.capacity +
      sumValues(user.orders, (group) => group.ckbValue),
    availableIckbBalance:
      walletUdtInfo.balance + sumValues(user.orders, (group) => group.udtValue),
  };
}

async function collectCapacityCells(
  signer: ccc.SignerCkbPrivateKey,
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];

  for await (const cell of signer.findCellsOnChain(
    {
      scriptLenRange: [0n, 1n],
      outputDataLenRange: [0n, 1n],
    },
    true,
    "asc",
    FIND_CELLS_PAGE_SIZE,
  )) {
    if (cell.cellOutput.type !== undefined || cell.outputData !== "0x") {
      continue;
    }

    cells.push(cell);
  }

  return cells;
}

async function collectWalletUdtCells(
  signer: ccc.SignerCkbPrivateKey,
  ickbUdt: Runtime["managers"]["ickbUdt"],
): Promise<ccc.Cell[]> {
  const cells: ccc.Cell[] = [];

  for await (const cell of signer.findCellsOnChain(
    ickbUdt.filter,
    true,
    "asc",
    FIND_CELLS_PAGE_SIZE,
  )) {
    if (!ickbUdt.isUdt(cell)) {
      continue;
    }

    cells.push(cell);
  }

  return cells;
}

async function hasFreshMatchableOrders(
  runtime: Runtime,
  orders: OrderGroup[],
  tip: ccc.ClientBlockHeader,
): Promise<boolean> {
  for (const group of orders) {
    if (!group.order.isMatchable()) {
      continue;
    }

    const txWithHeader = await runtime.client.getTransactionWithHeader(
      group.order.cell.outPoint.txHash,
    );
    if (!txWithHeader?.header) {
      throw new Error("Header not found for txHash");
    }

    if (txWithHeader.header.number + MAX_ELAPSED_BLOCKS >= tip.number) {
      return true;
    }
  }

  return false;
}

async function buildTransaction(
  runtime: Runtime,
  state: TesterState,
  amounts: { ckbValue: bigint; udtValue: bigint },
  info: Parameters<IckbSdk["request"]>[2],
): Promise<ccc.Transaction> {
  let tx = ccc.Transaction.default();

  if (state.userOrders.length > 0) {
    tx = runtime.sdk.collect(tx, state.userOrders);
  }

  tx = await runtime.sdk.request(tx, runtime.primaryLock, info, amounts);
  tx = await runtime.managers.ickbUdt.completeBy(tx, runtime.signer);
  await tx.completeFeeBy(runtime.signer, state.system.feeRate);

  if (await ccc.isDaoOutputLimitExceeded(tx, runtime.client)) {
    throw new Error(
      `NervosDAO transaction has ${String(tx.outputs.length)} output cells, exceeding the limit of 64`,
    );
  }

  return tx;
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

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
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

await main();
