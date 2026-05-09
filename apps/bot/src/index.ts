import { ccc } from "@ckb-ccc/core";
import {
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import {
  OrderManager,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";
import { getConfig, IckbSdk, type SystemState } from "@ickb/sdk";
import { isPlainCapacityCell } from "@ickb/utils";
import { CKB, planRebalance } from "./policy.js";

const MATCH_STEP_DIVISOR = 100n;
const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);
const MAX_OUTPUTS_BEFORE_CHANGE = 58;

interface Runtime {
  chain: SupportedChain;
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  managers: ReturnType<typeof getConfig>["managers"];
  primaryLock: ccc.Script;
}

interface BotState {
  accountLocks: ccc.Script[];
  system: SystemState;
  userOrders: OrderGroup[];
  marketOrders: OrderCell[];
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  notReadyWithdrawals: WithdrawalGroup[];
  readyPoolDeposits: IckbDepositCell[];
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
  unavailableCkbBalance: bigint;
  totalCkbBalance: bigint;
  depositCapacity: bigint;
  minCkbBalance: bigint;
}

type SupportedChain = "mainnet" | "testnet";

async function main(): Promise<void> {
  const { CHAIN, RPC_URL, BOT_PRIVATE_KEY, BOT_SLEEP_INTERVAL } = process.env;
  if (!CHAIN) {
    throw new Error("Invalid env CHAIN: Empty");
  }
  if (!BOT_PRIVATE_KEY) {
    throw new Error("Empty env BOT_PRIVATE_KEY");
  }
  if (!BOT_SLEEP_INTERVAL || Number(BOT_SLEEP_INTERVAL) < 1) {
    throw new Error("Invalid env BOT_SLEEP_INTERVAL");
  }

  const chain = parseChain(CHAIN);
  const client = createClient(chain, RPC_URL);
  const config = getConfig(chain);
  const { managers } = config;
  const signer = new ccc.SignerCkbPrivateKey(client, BOT_PRIVATE_KEY);
  const primaryLock = (await signer.getRecommendedAddressObj()).script;
  const runtime: Runtime = {
    chain,
    client,
    signer,
    sdk: IckbSdk.fromConfig(config),
    managers,
    primaryLock,
  };
  const sleepInterval = Number(BOT_SLEEP_INTERVAL) * 1000;

  for (;;) {
    await sleep(Math.floor(2 * Math.random() * sleepInterval));

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const executionLog: Record<string, any> = {};
    const startTime = new Date();
    executionLog.startTime = startTime.toLocaleString();

    try {
      const state = await readBotState(runtime);

      executionLog.balance = {
        CKB: {
          total: fmtCkb(state.totalCkbBalance),
          available: fmtCkb(state.availableCkbBalance),
          unavailable: fmtCkb(state.unavailableCkbBalance),
        },
        ICKB: {
          total: fmtCkb(state.availableIckbBalance),
          available: fmtCkb(state.availableIckbBalance),
          unavailable: fmtCkb(0n),
        },
        totalEquivalent: {
          CKB: fmtCkb(
            state.totalCkbBalance +
              convert(false, state.availableIckbBalance, state.system.tip),
          ),
          ICKB: fmtCkb(
            convert(true, state.totalCkbBalance, state.system.tip) +
              state.availableIckbBalance,
          ),
        },
      };
      executionLog.ratio = state.system.exchangeRatio;

      if (
        state.totalCkbBalance +
          convert(false, state.availableIckbBalance, state.system.tip) <=
        state.minCkbBalance
      ) {
        executionLog.error =
          "The bot must have more than " +
          String(fmtCkb(state.minCkbBalance)) +
          " CKB worth of capital to be able to operate, shutting down...";
        console.log(JSON.stringify(executionLog, replacer, " "));
        return;
      }

      const result = await buildTransaction(runtime, state);
      if (!result) {
        continue;
      }

      executionLog.actions = result.actions;
      executionLog.txFee = {
        fee: fmtCkb(await result.tx.getFee(runtime.client)),
        feeRate: state.system.feeRate,
      };
      executionLog.txHash = await runtime.signer.sendTransaction(result.tx);
    } catch (error) {
      executionLog.error = errorToLog(error);
    }

    executionLog.ElapsedSeconds = Math.round(
      (Date.now() - startTime.getTime()) / 1000,
    );
    console.log(JSON.stringify(executionLog, replacer, " "));
  }
}

async function readBotState(runtime: Runtime): Promise<BotState> {
  const accountLocks = dedupeScripts(
    (await runtime.signer.getAddressObjs()).map(({ script }) => script),
  );
  const { system, user } = await runtime.sdk.getL1State(
    runtime.client,
    accountLocks,
  );

  const [capacityCells, walletUdtCells, receipts, withdrawalGroups, readyPoolDeposits] =
    await Promise.all([
      collectCapacityCells(runtime.signer),
      collectWalletUdtCells(runtime.signer, runtime.managers.ickbUdt),
      collectAsync(
        runtime.managers.logic.findReceipts(runtime.client, accountLocks, {
          onChain: true,
        }),
      ),
      collectAsync(
        runtime.managers.ownedOwner.findWithdrawalGroups(
          runtime.client,
          accountLocks,
          {
            onChain: true,
            tip: system.tip,
          },
        ),
      ),
      collectReadyPoolDeposits(runtime.client, runtime.managers.logic, system.tip),
    ]);
  const walletUdtInfo = await runtime.managers.ickbUdt.infoFrom(
    runtime.client,
    walletUdtCells,
  );

  const { yes: readyWithdrawals, no: notReadyWithdrawals } = partition(
    withdrawalGroups,
    (group) => group.owned.isReady,
  );
  const ownedOrderKeys = new Set(
    user.orders.map((group) => outPointKey(group.order.cell.outPoint)),
  );
  const marketOrders = system.orderPool.filter(
    (order) => !ownedOrderKeys.has(outPointKey(order.cell.outPoint)),
  );

  const availableCkbBalance =
    sumValues(capacityCells, (cell) => cell.cellOutput.capacity) +
    walletUdtInfo.capacity +
    sumValues(user.orders, (group) => group.ckbValue) +
    sumValues(receipts, (receipt) => receipt.ckbValue) +
    sumValues(readyWithdrawals, (group) => group.ckbValue);
  const availableIckbBalance =
    walletUdtInfo.balance +
    sumValues(user.orders, (group) => group.udtValue) +
    sumValues(receipts, (receipt) => receipt.udtValue);
  const unavailableCkbBalance = sumValues(
    notReadyWithdrawals,
    (group) => group.ckbValue,
  );
  const totalCkbBalance = availableCkbBalance + unavailableCkbBalance;
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio);

  return {
    accountLocks,
    system,
    userOrders: user.orders,
    marketOrders,
    receipts,
    readyWithdrawals,
    notReadyWithdrawals,
    readyPoolDeposits,
    availableCkbBalance,
    availableIckbBalance,
    unavailableCkbBalance,
    totalCkbBalance,
    depositCapacity,
    minCkbBalance: (21n * depositCapacity) / 20n,
  };
}

async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<
  | {
      tx: ccc.Transaction;
      actions: {
        collectedOrders: number;
        completedDeposits: number;
        matchedOrders: number;
        deposits: number;
        withdrawalRequests: number;
        withdrawals: number;
      };
    }
  | undefined
> {
  let tx = ccc.Transaction.default();

  if (state.userOrders.length > 0) {
    tx = runtime.sdk.collect(tx, state.userOrders);
  }
  if (state.receipts.length > 0) {
    tx = runtime.managers.logic.completeDeposit(tx, state.receipts);
  }
  if (state.readyWithdrawals.length > 0) {
    tx = await runtime.managers.ownedOwner.withdraw(
      tx,
      state.readyWithdrawals,
      runtime.client,
    );
  }

  const match = OrderManager.bestMatch(
    state.marketOrders,
    {
      ckbValue: state.availableCkbBalance,
      udtValue: state.availableIckbBalance,
    },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      ckbAllowanceStep: maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR),
    },
  );
  if (match.partials.length > 0) {
    tx = runtime.managers.order.addMatch(tx, match);
  }

  const rebalance = planRebalance({
    outputSlots: maxInt(0, MAX_OUTPUTS_BEFORE_CHANGE - tx.outputs.length),
    ickbBalance: state.availableIckbBalance + match.udtDelta,
    ckbBalance: state.availableCkbBalance + match.ckbDelta,
    depositCapacity: state.depositCapacity,
    readyDeposits: state.readyPoolDeposits,
  });
  if (rebalance.kind === "deposit") {
    tx = await runtime.managers.logic.deposit(
      tx,
      rebalance.quantity,
      state.depositCapacity,
      runtime.primaryLock,
      runtime.client,
    );
  } else if (rebalance.kind === "withdraw") {
    tx = await runtime.managers.ownedOwner.requestWithdrawal(
      tx,
      rebalance.deposits,
      runtime.primaryLock,
      runtime.client,
    );
  }

  const actions = {
    collectedOrders: state.userOrders.length,
    completedDeposits: state.receipts.length,
    matchedOrders: match.partials.length,
    deposits: rebalance.kind === "deposit" ? rebalance.quantity : 0,
    withdrawalRequests:
      rebalance.kind === "withdraw" ? rebalance.deposits.length : 0,
    withdrawals: state.readyWithdrawals.length,
  };
  const actionCount = Object.values(actions).reduce((sum, count) => sum + count, 0);
  if (actionCount === 0) {
    return;
  }

  tx = await runtime.managers.ickbUdt.completeBy(tx, runtime.signer);
  await tx.completeFeeBy(runtime.signer, state.system.feeRate);

  if (await ccc.isDaoOutputLimitExceeded(tx, runtime.client)) {
    throw new Error(
      `NervosDAO transaction has ${String(tx.outputs.length)} output cells, exceeding the limit of 64`,
    );
  }

  return { tx, actions };
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
    400,
  )) {
    if (!isPlainCapacityCell(cell)) {
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
    400,
  )) {
    if (!ickbUdt.isUdt(cell)) {
      continue;
    }
    cells.push(cell);
  }

  return cells;
}

async function collectReadyPoolDeposits(
  client: ccc.Client,
  logic: Runtime["managers"]["logic"],
  tip: ccc.ClientBlockHeader,
): Promise<IckbDepositCell[]> {
  const deposits = await collectAsync(
    logic.findDeposits(client, {
      onChain: true,
      tip,
      minLockUp: POOL_MIN_LOCK_UP,
      maxLockUp: POOL_MAX_LOCK_UP,
    }),
  );

  return deposits
    .filter((deposit) => deposit.isReady)
    .sort((left, right) =>
      compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
    );
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

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
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

function partition<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): { yes: T[]; no: T[] } {
  const yes: T[] = [];
  const no: T[] = [];

  for (const item of items) {
    if (predicate(item)) {
      yes.push(item);
    } else {
      no.push(item);
    }
  }

  return { yes, no };
}

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function outPointKey(outPoint: ccc.OutPoint): string {
  return ccc.hexFrom(outPoint.toBytes());
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function maxInt(left: number, right: number): number {
  return left > right ? left : right;
}

function fmtCkb(balance: bigint): number {
  return Number(balance) / Number(CKB);
}

function replacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

function errorToLog(error: unknown): unknown {
  if (error instanceof Object && "stack" in error) {
    const stack = error.stack ?? "";
    return {
      name: "name" in error ? error.name : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : "Unknown error",
      stack,
    };
  }

  return error ?? "Empty Error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

await main();
