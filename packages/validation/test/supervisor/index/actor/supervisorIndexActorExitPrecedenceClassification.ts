import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_ITERATION_FAILED,
  BOT_TRANSACTION_COMMITTED,
  CLASSIFICATION_SUITE,
  FETCH_FAILED,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  botEvent,
  commandResult,
  emptyActions,
  fakeChild,
  fakeSuccessfulPreflightChild,
  isPreflightCommand,
  runSupervisorFixture,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("keeps bot low-capital safety stops classified despite exit code 2", () => {
    const result = {
      ...commandResult(
        "bot",
        JSON.stringify(
          botEvent(BOT_DECISION_SKIPPED, {
            reason: "capital_below_minimum",
            actions: emptyActions(),
          }),
        ),
      ),
      status: 2,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "low_capital_stop",
      terminal: true,
      skipReason: "capital_below_minimum",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("returns the actor exit status for nonzero-exit incidents", async () => {
    const { exitCode } = await runSupervisorFixture(
      [SCENARIO_FLAG, "bot-only", MAX_CYCLES_FLAG, "1"],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild("", 1),
    );

    expect(exitCode).toBe(1);
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies later bot failures over older no-action skips", () => {
    const stdout = [
      botEvent(BOT_DECISION_SKIPPED, {
        iterationId: 1,
        reason: "no_actions",
        actions: emptyActions(),
      }),
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 2,
        retryable: true,
        terminal: false,
        error: { name: "TypeError", message: FETCH_FAILED },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: false,
      reason: "bot reported retryable iteration failure",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies later bot terminal failures over older low-capital skips", () => {
    const stdout = [
      botEvent(BOT_DECISION_SKIPPED, {
        iterationId: 1,
        reason: "capital_below_minimum",
        actions: emptyActions(),
      }),
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 2,
        retryable: false,
        terminal: true,
        error: { name: "Error", message: "boom" },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_terminal_error",
      terminal: true,
      reason: "bot reported terminal iteration failure: boom",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("treats nonzero actor exits as terminal even when stdout has success evidence", () => {
    const botResult = {
      ...commandResult(
        "bot",
        JSON.stringify(
          botEvent(BOT_DECISION_SKIPPED, {
            reason: "no_actions",
            actions: emptyActions(),
          }),
        ),
      ),
      status: 1,
    };
    const botTxResult = {
      ...commandResult(
        "bot",
        JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("98") })),
      ),
      status: 1,
    };
    const testerResult = {
      ...commandResult("tester", JSON.stringify({ txHash: txHash("99") })),
      status: 1,
    };

    expect(classifyActorResult("bot", botResult)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
    });
    expect(classifyActorResult("bot", botTxResult)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      txHashes: [txHash("98")],
    });
    expect(classifyActorResult("tester", testerResult)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      txHashes: [txHash("99")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("treats nonzero bot exits as terminal even with retryable iteration evidence", () => {
    const result = {
      ...commandResult(
        "bot",
        JSON.stringify(
          botEvent(BOT_ITERATION_FAILED, {
            retryable: true,
            terminal: false,
            error: { name: "TypeError", message: FETCH_FAILED },
          }),
        ),
      ),
      status: 1,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("keeps terminal bot retry-budget exhaustion classified by bot evidence despite exit code 2", () => {
    const result = {
      ...commandResult(
        "bot",
        JSON.stringify(
          botEvent(BOT_ITERATION_FAILED, {
            retryable: true,
            terminal: true,
            retryableAttempts: 3,
            maxRetryableAttempts: 3,
            retryBudgetExhausted: true,
            error: { name: "TypeError", message: FETCH_FAILED },
          }),
        ),
      ),
      status: 2,
    };

    expect(classifyActorResult("bot", result)).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: true,
      reason: "bot reported terminal retryable iteration failure",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("gives nonzero tester status precedence over retryable evidence", () => {
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          JSON.stringify({
            error: {
              message: "Retryable tester error",
              retryable: true,
              terminal: false,
              retryableAttempts: 1,
              maxRetryableAttempts: 3,
              retryBudgetExhausted: false,
            },
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "tester_retryable_error",
      terminal: false,
      reason: "tester reported retryable iteration failure",
    });

    expect(
      classifyActorResult("tester", {
        ...commandResult(
          "tester",
          JSON.stringify({
            error: {
              message: "Retryable tester error budget exhausted",
              retryable: true,
              terminal: true,
              retryableAttempts: 3,
              maxRetryableAttempts: 3,
              retryBudgetExhausted: true,
            },
          }),
        ),
        status: 2,
      }),
    ).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "tester exited with status 2",
    });
  });
});
