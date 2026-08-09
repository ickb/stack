import {
  classifyActorResult,
  type CommandResult,
} from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_STATE_READ,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  FRESH_MATCHABLE_ORDER,
  MIXED_DIRECTION_SCENARIO,
  MULTI_ORDER_SCENARIO,
  PREFLIGHT_CKB_AVAILABLE,
  PREFLIGHT_ICKB_AVAILABLE,
  RANDOM_ORDER_SCENARIO,
  TWO_ICKB_TO_CKB_SCENARIO,
  txHash,
} from "./supervisorIndexConstants.ts";

export function multiOrderResult(scenario: string, txByte: string): CommandResult {
  const orderPair =
    scenario === TWO_ICKB_TO_CKB_SCENARIO
      ? [
          { giveIckb: "10", takeCkb: "9", fee: "0.1" },
          { giveIckb: "20", takeCkb: "18", fee: "0.2" },
        ]
      : [
          { giveCkb: "10", takeIckb: "9", fee: "0.1" },
          scenario === MIXED_DIRECTION_SCENARIO
            ? { giveIckb: "20", takeCkb: "18", fee: "0.2" }
            : { giveCkb: "20", takeIckb: "18", fee: "0.2" },
        ];
  return commandResult(
    "tester",
    JSON.stringify({
      startTime: "now",
      actions: {
        requestedTesterScenario: MULTI_ORDER_SCENARIO,
        testerScenario: scenario,
        newOrders: orderPair,
        orderCount: 2,
        cancelledOrders: 0,
      },
      txHash: txHash(txByte),
      ElapsedSeconds: 1,
    }),
  );
}
export function testerSkipClassification(
  reason: string,
  txByte?: string,
): ReturnType<typeof classifyActorResult> {
  const skip = txByte === undefined ? { reason } : { reason, txHash: txHash(txByte) };
  return classifyActorResult("tester", commandResult("tester", JSON.stringify({ skip })));
}
export function botNoActionStdout(): string {
  return JSON.stringify(
    botEvent(BOT_DECISION_SKIPPED, {
      reason: "no_actions",
      actions: emptyActions(),
    }),
  );
}
export function botCommitStdout({
  txByte,
  actions,
  decision,
  extraCommit,
  iterationId = 1,
  stateAfter,
  stateBefore,
}: {
  txByte: string;
  actions: Record<string, number>;
  decision?: Record<string, unknown>;
  extraCommit?: Record<string, unknown>;
  iterationId?: number;
  stateAfter?: Record<string, unknown>;
  stateBefore?: Record<string, unknown>;
}): string {
  const decisionWithBalances = withBalanceEvidence(decision);
  return [
    JSON.stringify(
      botStateReadEvent({
        iterationId,
        ...stateBefore,
        balances: balanceEvidence(decisionWithBalances),
      }),
    ),
    JSON.stringify(
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId,
        actions,
        decision: decisionWithBalances,
      }),
    ),
    JSON.stringify(
      botEvent(BOT_TRANSACTION_COMMITTED, {
        iterationId,
        txHash: txHash(txByte),
        status: "committed",
        ...extraCommit,
      }),
    ),
    JSON.stringify(botStateReadEvent({ iterationId: iterationId + 1, ...stateAfter })),
  ].join("\n");
}

export function botStateReadEvent(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return botEvent(BOT_STATE_READ, {
    ...fields,
    balances: isRecord(fields["balances"])
      ? { ...defaultBalanceEvidence(), ...fields["balances"] }
      : defaultBalanceEvidence(),
  });
}
export function freshSkipTwoPassStdout(testerRuns: number, txByte: string): string {
  return testerRuns === 1
    ? testerOrderStdout({
        txByte,
        order: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
      })
    : testerSkipStdout(FRESH_MATCHABLE_ORDER, txByte);
}
export function testerOrderStdout({
  txByte,
  scenario = RANDOM_ORDER_SCENARIO,
  order = { giveCkb: "10", takeIckb: "9", fee: "0.1" },
}: {
  txByte: string;
  scenario?: string;
  order?: Record<string, string>;
}): string {
  return JSON.stringify({
    startTime: "now",
    actions: { testerScenario: scenario, newOrder: order, cancelledOrders: 0 },
    txHash: txHash(txByte),
    ElapsedSeconds: 1,
  });
}
export function testerSkipStdout(reason: string, txByte: string): string {
  return JSON.stringify({ skip: { reason, txHash: txHash(txByte) } });
}
export function safePreflightBalances(): {
  ckbAvailable: string;
  ckbProjectedAvailable: string;
  ckbSpendable: string;
  ickbAvailable: string;
  ickbUnavailable: string;
  ickbTotal: string;
} {
  return {
    ckbAvailable: PREFLIGHT_CKB_AVAILABLE,
    ckbProjectedAvailable: PREFLIGHT_CKB_AVAILABLE,
    ckbSpendable: "853.99897309",
    ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
    ickbUnavailable: "5",
    ickbTotal: "250843.31219989",
  };
}
export function expectedTesterPreflightState(step: string): Record<string, unknown> {
  return {
    cycleIndex: 1,
    actor: "tester",
    step,
    selectedTesterScenario: RANDOM_ORDER_SCENARIO,
    balances: {
      CKB: {
        available: PREFLIGHT_CKB_AVAILABLE,
        plainAvailable: PREFLIGHT_CKB_AVAILABLE,
        projectedAvailable: PREFLIGHT_CKB_AVAILABLE,
        spendable: "853.99897309",
      },
      ICKB: {
        available: PREFLIGHT_ICKB_AVAILABLE,
        unavailable: "5",
        total: "250843.31219989",
      },
    },
  };
}
export function profitableBotMatchDecision(): Record<string, unknown> {
  return {
    balances: defaultBalanceEvidence(),
    match: { value: "1001" },
    fee: { estimated: "10" },
    exchangeRatio: { ckbScale: "100" },
  };
}

export function withBalanceEvidence(
  decision: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...decision,
    balances: {
      ...defaultBalanceEvidence(),
      ...(isRecord(decision?.["balances"]) ? decision["balances"] : {}),
    },
  };
}

export function defaultBalanceEvidence(): Record<string, string> {
  return {
    availableCkb: "1000",
    availableIckb: "2000",
    unavailableCkb: "3000",
    totalCkb: "4000",
  };
}

function balanceEvidence(decision: Record<string, unknown>): Record<string, string> {
  return isRecord(decision["balances"])
    ? {
        availableCkb: String(decision["balances"]["availableCkb"]),
        availableIckb: String(decision["balances"]["availableIckb"]),
        unavailableCkb: String(decision["balances"]["unavailableCkb"]),
        totalCkb: String(decision["balances"]["totalCkb"]),
      }
    : defaultBalanceEvidence();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function botActions(
  overrides: Partial<Record<string, number>> = {},
): Record<string, number> {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
    ...overrides,
  };
}
export function commandResult(
  actor: "bot" | "tester" | "preflight",
  stdout: string,
): CommandResult {
  return {
    actor,
    command: "fixture",
    args: [],
    status: 0,
    signal: null,
    timedOut: false,
    stdout: `${stdout}\n`,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    elapsedMs: 1,
    timeoutMs: 900000,
  };
}
export function botEvent(
  type: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "test",
    iterationId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    ...fields,
  };
}
export function emptyActions(): Record<string, number> {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}
