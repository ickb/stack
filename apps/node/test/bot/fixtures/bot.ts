import { ccc } from "@ckb-ccc/core";
import {
  DaoManager,
  getConfig,
  type IckbDepositCell,
  ickbDepositCellFrom,
  IckbSdk,
  type Match,
  type MatchSearchResult,
  OrderData,
  type OrderGroup,
  OwnerCell,
  OwnerData,
  Ratio,
  WithdrawalGroup,
} from "@ickb/sdk";

import {
  byte32FromByte,
  chainState,
  committedTransactionResponse,
  FakeClient,
  headerLike,
  script,
  StubClient,
} from "@ickb/testkit";
import type { BotState, Runtime } from "../../../src/bot/runtime/types.ts";

type TestWithdrawalRequestCell = ConstructorParameters<typeof WithdrawalGroup>[0];

export interface BotRuntimeOptions {
  client?: ccc.Client;
  completeTransaction?: Runtime["completeTransaction"];
  sendTransaction?: Runtime["sendTransaction"];
  sdk?: Partial<Pick<IckbSdk, "getL1AccountState">>;
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
/** Plain change the default test completion returns: comfortably above the reserve. */
export const FUNDED_CHANGE = ccc.fixedPointFrom(2000);
/** An iCKB balance inside the band: above the refill line, below the withdrawal line. */
export const BAND_ICKB_BALANCE = ccc.fixedPointFrom(50_000);
export const NO_DEPOSITS: IckbDepositCell[] = [];

/**
 * A ready pool deposit shaped for the real DAO and owned-owner builders, with the iCKB value
 * and maturity the policy tests dictate rather than the ones the cell would imply.
 */
export function readyDeposit(
  byte: string,
  udtValue: bigint,
  maturityUnix: bigint,
  options: { isReady?: boolean } = {},
): IckbDepositCell {
  const minute = 60n * 1000n;
  const ringEpoch = maturityUnix % minute === 0n ? maturityUnix / minute : maturityUnix;
  const { logic, dao } = getConfig("testnet").managers;
  const tip = headerLike({ epoch: [1n, 0n, 1n], number: 0n });
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100_082),
      lock: logic.script,
      type: dao.script,
    },
    outputData: DaoManager.depositData(),
  });
  const deposit = ickbDepositCellFrom(
    {
      cell,
      headers: [{ header: tip, txHash: cell.outPoint.txHash }, { header: tip }],
      interests: 0n,
      maturity: new TestEpoch(ringEpoch, 0n, 1n, maturityUnix),
      isReady: options.isReady ?? true,
      isDeposit: true,
      ckbValue: udtValue,
      udtValue: 0n,
    },
    logic.script,
  );
  return Object.assign(deposit, { udtValue });
}

/** A partial that pays the matcher `ckbDelta` CKB and `udtDelta` iCKB out of a real order. */
export async function testMatch(
  byte: string,
  { ckbDelta = 0n, udtDelta = 0n }: { ckbDelta?: bigint; udtDelta?: bigint } = {},
): Promise<Match["partials"][number]> {
  const group = await testOrderGroup(byte);
  return {
    group,
    ckbOut: group.order.ckbValue - ckbDelta,
    udtOut: group.order.udtValue - udtDelta,
  };
}

/** A search result whose deltas are the sum of its partials, as the real matcher's are. */
export function searchResult(
  kind: "complete" | "incomplete",
  partials: Match["partials"],
  diagnostics?: Match["diagnostics"],
): MatchSearchResult {
  const match: Match = {
    ckbDelta: partials.reduce(
      (sum, { group, ckbOut }) => sum + group.order.ckbValue - ckbOut,
      0n,
    ),
    udtDelta: partials.reduce(
      (sum, { group, udtOut }) => sum + group.order.udtValue - udtOut,
      0n,
    ),
    partials,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
  if (kind === "complete") {
    return completeSearchResult(match);
  }
  return incompleteSearchResult(match);
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

/** A ready withdrawal request under the owned-owner lock with its owner marker one output later. */
export function testWithdrawal(byte: string): WithdrawalGroup {
  const { dao, ownedOwner } = getConfig("testnet").managers;
  const depositHeader = headerLike({ number: 1n, hash: hash("d0") });
  const requestHeader = headerLike({ number: 2n, hash: hash("d1") });
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100_082),
      lock: ownedOwner.script,
      type: dao.script,
    },
    outputData: ccc.hexFrom(ccc.numLeToBytes(1n, 8)),
  });
  const owned: TestWithdrawalRequestCell = {
    cell,
    headers: [
      { header: depositHeader, txHash: hash("d0") },
      { header: requestHeader, txHash: cell.outPoint.txHash },
    ],
    interests: 0n,
    maturity: new TestEpoch(0n, 0n, 1n, 0n),
    isReady: true,
    isDeposit: false,
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
  };
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: { txHash: hash(byte), index: 1n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100),
        lock: script("11"),
        type: ownedOwner.script,
      },
      outputData: OwnerData.encode({ ownedDistance: -1n }),
    }),
  );
  return new WithdrawalGroup(owned, owner);
}

/**
 * The real testnet SDK and managers behind a stubbed L1 read, completion, and send: the
 * builders mutate transactions in place and assert their inputs, which is what the bot
 * tests must exercise (decisions amendment 47(i)).
 */
export function botRuntime(overrides: BotRuntimeOptions = {}): Runtime {
  const client = overrides.client ?? new FakeClient(chainState());
  const config = getConfig("testnet");
  const primaryLock = overrides.primaryLock ?? script("11");

  return {
    client,
    managers: {
      dao: Object.assign(config.managers.dao, overrides.managers?.dao),
      ickbUdt: Object.assign(config.managers.ickbUdt, overrides.managers?.ickbUdt),
      order: Object.assign(config.managers.order, overrides.managers?.order),
      ownedOwner: Object.assign(
        config.managers.ownedOwner,
        overrides.managers?.ownedOwner,
      ),
      logic: Object.assign(config.managers.logic, overrides.managers?.logic),
    },
    sdk: Object.assign(IckbSdk.fromConfig(config), {
      getL1AccountState: async (): ReturnType<IckbSdk["getL1AccountState"]> => {
        await Promise.resolve();
        return l1AccountState();
      },
      ...overrides.sdk,
    }),
    primaryLock,
    accountLocks: [script("11")],
    // The default completion models a funded account: it hands the reserve back as change.
    completeTransaction:
      overrides.completeTransaction ??
      (async (tx): Promise<ccc.Transaction> => {
        await Promise.resolve();
        const completed = ccc.Transaction.from(tx).clone();
        completed.addOutput({ capacity: FUNDED_CHANGE, lock: primaryLock }, "0x");
        return completed;
      }),
    sendTransaction:
      overrides.sendTransaction ??
      (async (): Promise<ccc.Hex> => {
        await Promise.resolve();
        return hash("ff");
      }),
  };
}

export function botState(overrides: Partial<BotState>): BotState {
  const state: BotState = {
    marketOrders: [],
    ckb: 0n,
    ickb: 0n,
    pendingCkb: 0n,
    depositCapacity: ccc.fixedPointFrom(100_000),
    receipts: [],
    readyWithdrawals: [],
    notReadyWithdrawals: [],
    poolDeposits: [],
    cells: [],
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

/**
 * An order carrying 100 CKB and 1000 iCKB under the testnet order scripts, produced by the
 * resolver because the builders accept nothing else; its master sits one output later.
 */
async function testOrderGroup(byte: string): Promise<OrderGroup> {
  const manager = getConfig("testnet").managers.order;
  const { script: orderLock, udtScript } = manager;
  const outputData = OrderData.from({
    udtValue: ccc.fixedPointFrom(1000),
    master: { type: "relative", value: { distance: 1n, padding: new Uint8Array(32) } },
    info: {
      ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      udtToCkb: Ratio.empty(),
      ckbMinMatchLog: 0,
    },
  }).toBytes();
  const minimal = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 1n },
    cellOutput: { lock: orderLock, type: udtScript },
    outputData,
  });
  const order = ccc.Cell.from({
    outPoint: minimal.outPoint,
    cellOutput: {
      capacity: minimal.cellOutput.capacity + ccc.fixedPointFrom(100),
      lock: orderLock,
      type: udtScript,
    },
    outputData,
  });
  const master = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 2n },
    cellOutput: { capacity: ccc.fixedPointFrom(74), lock: script("54"), type: orderLock },
    outputData: "0x",
  });
  const mint = ccc.Transaction.default();
  mint.outputs.push(
    ccc.CellOutput.from({ capacity: 0n, lock: script("00") }),
    order.cellOutput,
    master.cellOutput,
  );
  mint.outputsData.push("0x", order.outputData, master.outputData);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
      await Promise.resolve();
      if (query.scriptType === "lock") {
        yield order;
      } else {
        yield master;
      }
    },
    getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
      await Promise.resolve();
      return committedTransactionResponse(mint);
    },
  });
  const groups: OrderGroup[] = [];
  for await (const group of manager.findOrders(client)) {
    groups.push(group);
  }
  const group = groups[0];
  if (group === undefined || groups.length !== 1) {
    throw new Error("Expected one resolver-produced order fixture");
  }
  return group;
}

export type L1AccountState = Awaited<ReturnType<IckbSdk["getL1AccountState"]>>;

export function l1AccountState(
  account: Partial<L1AccountState["account"]> = {},
): L1AccountState {
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
      ...account,
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
