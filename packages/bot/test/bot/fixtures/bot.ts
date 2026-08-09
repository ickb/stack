import { ccc } from "@ckb-ccc/core";
import {
  OwnerCell,
  ReceiptData,
  WithdrawalGroup,
  type IckbDepositCell,
} from "@ickb/core";
import {
  MasterCell,
  OrderCell,
  OrderData,
  OrderGroup,
  Ratio,
  type Match,
  type MatchSearchResult,
} from "@ickb/order";
import { getConfig, IckbSdk } from "@ickb/sdk";
import { byte32FromByte, headerLike, outPoint, script } from "@ickb/testkit";
import type { BotState, Runtime } from "../../../src/runtime/types.ts";

type TestWithdrawalRequestCell = ConstructorParameters<typeof WithdrawalGroup>[0];

export interface BotRuntimeOptions {
  completeTransaction?: Runtime["completeTransaction"];
  sdk?: Partial<{
    buildBaseTransaction: IckbSdk["buildBaseTransaction"];
    getL1AccountState: IckbSdk["getL1AccountState"];
  }>;
  primaryLock?: ccc.Script;
  managers?: {
    dao?: Partial<Runtime["managers"]["dao"]>;
    ickbUdt?: Partial<Runtime["managers"]["ickbUdt"]>;
    order?: Partial<Runtime["managers"]["order"]>;
    ownedOwner?: Partial<Runtime["managers"]["ownedOwner"]>;
    logic?: Partial<Runtime["managers"]["logic"]>;
  };
}

export const hash = byte32FromByte;
export const TARGET_ICKB_BALANCE = ccc.fixedPointFrom(120000);
export const NO_DEPOSITS: IckbDepositCell[] = [];

export function readyDeposit(
  byte: string,
  udtValue: bigint,
  maturityUnix: bigint,
  options: { isReady?: boolean } = {},
): IckbDepositCell {
  const minute = 60n * 1000n;
  const ringEpoch = maturityUnix % minute === 0n ? maturityUnix / minute : maturityUnix;
  const deposit: TestDepositCell = {
    cell: ccc.Cell.from({
      outPoint: { txHash: hash(byte), index: 0n },
      cellOutput: {
        capacity: 0n,
        lock: script("22"),
      },
      outputData: "0x",
    }),
    isReady: options.isReady ?? true,
    ckbValue: udtValue,
    udtValue,
    maturity: new TestEpoch(ringEpoch, 0n, 1n, maturityUnix),
  };
  if (isDepositFixture(deposit)) {
    return deposit;
  }
  throw new Error("Invalid deposit fixture");
}

export function testMatch(byte: string): Match["partials"][number] {
  return { group: testOrderGroup(byte), ckbOut: 0n, udtOut: 0n };
}

export function completeSearchResult(match: Match): MatchSearchResult {
  return { kind: "complete", match };
}

export function incompleteSearchResult(match: Match): MatchSearchResult {
  return {
    kind: "incomplete",
    match,
    reason: "atomic_domain_exceeds_budget",
    searchMode: "stepped",
    budget: 100_000,
    work: 10,
    truncation: { phase: "preflight", requiredWork: 100_001n },
  };
}

export function testWithdrawal(byte: string): WithdrawalGroup {
  const cell = ccc.Cell.from({
    outPoint: outPoint(byte),
    cellOutput: { capacity: 0n, lock: script("91") },
    outputData: "0x0000000000000000",
  });
  const header = { header: headerLike(), txHash: hash(byte) };
  const owned: TestWithdrawalRequestCell = {
    cell,
    headers: [header, header],
    interests: 0n,
    maturity: new TestEpoch(0n, 0n, 1n, 0n),
    isReady: true,
    isDeposit: false,
    ckbValue: 0n,
    udtValue: 0n,
  };
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: outPoint("90"),
      cellOutput: { capacity: 0n, lock: script("90") },
      outputData: ReceiptData.encode({
        depositQuantity: 0n,
        depositAmount: 0n,
      }),
    }),
  );
  return new WithdrawalGroup(owned, owner);
}

export function botRuntime(overrides: BotRuntimeOptions = {}): Runtime {
  const client = new ccc.ClientPublicTestnet({
    url: "https://example.invalid",
  });
  const config = getConfig("testnet");
  const sdk = botSdk(config, overrides.sdk);

  return {
    client,
    managers: botManagers(config, overrides.managers),
    sdk,
    primaryLock: overrides.primaryLock ?? script("11"),
    accountLocks: [script("11")],
    completeTransaction:
      overrides.completeTransaction ??
      (async (tx): Promise<ccc.Transaction> => {
        await Promise.resolve();
        return ccc.Transaction.from(tx);
      }),
    sendTransaction: async (): Promise<ccc.Hex> => {
      await Promise.resolve();
      return hash("ff");
    },
  };
}

export function botState(overrides: Partial<BotState>): BotState {
  const state: BotState = {
    marketOrders: [],
    availableCkbBalance: 0n,
    availableIckbBalance: 0n,
    unavailableCkbBalance: 0n,
    totalCkbBalance: 0n,
    depositCapacity: 100n,
    minCkbBalance: 0n,
    userOrders: [],
    receipts: [],
    readyWithdrawals: [],
    notReadyWithdrawals: [],
    poolDeposits: [],
    system: {
      feeRate: 1n,
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      tip: headerLike(),
      orderPool: [],
      poolDeposits: { deposits: [], id: "empty" },
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    ...overrides,
  };
  return state;
}

function botManagers(
  config: ReturnType<typeof getConfig>,
  overrides: BotRuntimeOptions["managers"],
): Runtime["managers"] {
  return {
    dao: Object.assign(config.managers.dao, overrides?.dao),
    ickbUdt: Object.assign(config.managers.ickbUdt, overrides?.ickbUdt),
    order: Object.assign(
      config.managers.order,
      {
        addMatch: (txLike: ccc.TransactionLike): ccc.Transaction =>
          ccc.Transaction.from(txLike),
      },
      overrides?.order,
    ),
    ownedOwner: Object.assign(
      config.managers.ownedOwner,
      { script: script("33") },
      overrides?.ownedOwner,
    ),
    logic: Object.assign(
      config.managers.logic,
      {
        deposit: (txLike: ccc.TransactionLike): ccc.Transaction =>
          ccc.Transaction.from(txLike),
      },
      overrides?.logic,
    ),
  };
}

function botSdk(
  config: ReturnType<typeof getConfig>,
  overrides: BotRuntimeOptions["sdk"],
): IckbSdk {
  return Object.assign(IckbSdk.fromConfig(config), {
    buildBaseTransaction: (txLike: ccc.TransactionLike): ccc.Transaction =>
      ccc.Transaction.from(txLike),
    getL1AccountState: async (): ReturnType<IckbSdk["getL1AccountState"]> => {
      await Promise.resolve();
      return emptyL1AccountState();
    },
    ...overrides,
  });
}

function testOrderCell(byte: string): OrderCell {
  return new OrderCell(
    ccc.Cell.from({
      outPoint: { txHash: hash(byte), index: 1n },
      cellOutput: { capacity: 0n, lock: script("55") },
      outputData: "0x",
    }),
    OrderData.from({
      udtValue: 0n,
      master: {
        type: "relative",
        value: { distance: 1n, padding: new Uint8Array(32) },
      },
      info: {
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      },
    }),
    0n,
    0n,
    0n,
    undefined,
  );
}

function testOrderGroup(byte: string): OrderGroup {
  const order = testOrderCell(byte);
  return new OrderGroup(
    new MasterCell(
      ccc.Cell.from({
        outPoint: { txHash: hash(byte), index: 0n },
        cellOutput: {
          capacity: 0n,
          lock: script("54"),
          type: order.cell.cellOutput.lock,
        },
        outputData: "0x",
      }),
    ),
    order,
    order,
  );
}

function emptyL1AccountState(): Awaited<ReturnType<IckbSdk["getL1AccountState"]>> {
  return {
    system: {
      tip: headerLike(),
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      feeRate: 1n,
      poolDeposits: { deposits: [], id: "empty" },
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    user: { orders: [] },
    account: {
      capacityCells: [],
      nativeUdtCells: [],
      nativeUdtCapacity: 0n,
      nativeUdtBalance: 0n,
      receipts: [],
      withdrawalGroups: [],
    },
  };
}

class TestEpoch extends ccc.Epoch {
  private readonly unix: bigint;

  constructor(integer: bigint, numerator: bigint, denominator: bigint, unix: bigint) {
    super(integer, numerator, denominator);
    this.unix = unix;
  }

  public override add(epoch: ccc.EpochLike): ccc.Epoch {
    const added = super.add(epoch);
    return new TestEpoch(
      added.integer,
      added.numerator,
      added.denominator,
      this.unix + 16n,
    );
  }

  public override toUnix(): bigint {
    return this.unix;
  }
}

interface TestDepositCell {
  cell: ccc.Cell;
  isReady: boolean;
  ckbValue: bigint;
  udtValue: bigint;
  maturity: ccc.Epoch;
}

function isDepositFixture(value: unknown): value is IckbDepositCell {
  return typeof value === "object" && value !== null && "cell" in value;
}
