import {
  BOT_DECISION_SKIPPED,
  BOT_STATE_READ,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  botActions,
  botEvent,
  botStateReadEvent,
  profitableBotMatchDecision,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";

export function botCommitWithoutPostStateStdout(txByte: string): string {
  const actions = botActions({ matchedOrders: 1 });
  return [
    botStateReadEvent({ iterationId: 1 }),
    botEvent(BOT_TRANSACTION_BUILT, {
      iterationId: 1,
      actions,
      decision: profitableBotMatchDecision(),
    }),
    botEvent(BOT_TRANSACTION_COMMITTED, {
      iterationId: 1,
      txHash: txHash(txByte),
      status: "committed",
    }),
  ]
    .map(stringifyJsonLine)
    .join("\n");
}

export function botDoubleCommitStdout(firstTxByte: string, secondTxByte: string): string {
  const actions = botActions({ matchedOrders: 1 });
  const decision = profitableBotMatchDecision();
  return [
    botStateReadEvent({ iterationId: 1 }),
    botEvent(BOT_TRANSACTION_BUILT, { iterationId: 1, actions, decision }),
    botEvent(BOT_TRANSACTION_COMMITTED, {
      iterationId: 1,
      txHash: txHash(firstTxByte),
      status: "committed",
    }),
    botEvent(BOT_TRANSACTION_BUILT, { iterationId: 1, actions, decision }),
    botEvent(BOT_TRANSACTION_COMMITTED, {
      iterationId: 1,
      txHash: txHash(secondTxByte),
      status: "committed",
    }),
  ]
    .map(stringifyJsonLine)
    .join("\n");
}

export function botCommitThenTerminalFailureStdout(): string {
  const actions = botActions({ matchedOrders: 1 });
  return [
    botStateReadEvent({ iterationId: 1 }),
    botEvent(BOT_TRANSACTION_BUILT, {
      iterationId: 1,
      actions,
      decision: profitableBotMatchDecision(),
    }),
    botEvent(BOT_TRANSACTION_COMMITTED, {
      iterationId: 1,
      txHash: txHash("98"),
      status: "committed",
    }),
    botEvent("bot.transaction.failed", {
      iterationId: 1,
      phase: "confirmation",
      outcome: "confirmation_failed",
      status: "rejected",
      retryable: false,
      terminal: true,
      txHash: txHash("99"),
    }),
  ]
    .map(stringifyJsonLine)
    .join("\n");
}

export function botStateReadSkipStdout(): string {
  return [
    botStateReadEvent({ iterationId: 1 }),
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 1,
      reason: "no_actions",
      actions: botActions(),
    }),
  ]
    .map(stringifyJsonLine)
    .join("\n");
}

export function botIncompleteStateReadSkipStdout(): string {
  return [
    botEvent(BOT_STATE_READ, {
      iterationId: 1,
      balances: {
        availableCkb: "1000",
        availableIckb: "2000",
        unavailableCkb: "3000",
      },
    }),
    botEvent(BOT_DECISION_SKIPPED, {
      iterationId: 1,
      reason: "no_actions",
      actions: botActions(),
    }),
  ]
    .map(stringifyJsonLine)
    .join("\n");
}

export function botTerminalStopStdout(): string {
  return stringifyJsonLine(
    botEvent("bot.iteration.failed", {
      iterationId: 1,
      terminal: true,
      retryable: false,
    }),
  );
}
