import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  CLASSIFICATION_SUITE,
  FETCH_FAILED,
  MALFORMED_JSON_LINE,
  TRANSACTION_CONFIRMATION_TIMEOUT,
  botEvent,
  commandResult,
  emptyActions,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("rejects mismatched top-level and nested tester transaction failure tx hashes", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          txHash: txHash("ae"),
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            txHash: txHash("af"),
            isTimeout: true,
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies serialized tester post-broadcast unresolved failures", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          txHash: txHash("ab"),
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            txHash: txHash("ab"),
            status: "sent",
            isTimeout: true,
            cause: { name: "TypeError", message: FETCH_FAILED },
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "post_broadcast_unresolved",
      terminal: true,
      reason: "tester tx remained unresolved after broadcast",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies serialized tester terminal chain rejections", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          txHash: txHash("ac"),
          error: {
            name: "TransactionConfirmationError",
            message: "Transaction reached rejected status",
            txHash: txHash("ac"),
            status: "rejected",
            isTimeout: false,
          },
        }),
      ),
      status: 1,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "terminal_chain_rejection",
      terminal: true,
      reason: "tester tx reached terminal chain rejection",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects tester transaction failures without valid tx hash evidence", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            isTimeout: true,
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester transaction failure evidence did not include a valid tx hash",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("extracts nested tester transaction failure tx hash evidence", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            txHash: txHash("ad"),
            isTimeout: true,
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
      txHashes: [txHash("ad")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies serialized tester funding failures as low-capital stops", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          error: {
            name: "TesterTerminalError",
            message: "Not enough CKB for all-CKB limit order scenario",
          },
        }),
      ),
      status: 1,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "low_capital_stop",
      terminal: true,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("safety classifications preserve ordinary command precedence", () => {
    expect(
      classifyActorResult("bot", commandResult("bot", MALFORMED_JSON_LINE)),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
    });
    expect(
      classifyActorResult("bot", {
        ...commandResult("bot", ""),
        timedOut: true,
      }),
    ).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
    expect(
      classifyActorResult(
        "bot",
        commandResult(
          "bot",
          [
            JSON.stringify(
              botEvent(BOT_DECISION_SKIPPED, {
                reason: "no_actions",
                actions: emptyActions(),
              }),
            ),
            JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
          ].join("\n"),
        ),
      ),
    ).toMatchObject({
      outcome: "bot_no_action_skip",
      terminal: false,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies terminal preflight command failures before launch", () => {
    expect(
      classifyActorResult("preflight", {
        ...commandResult("preflight", ""),
        timedOut: true,
      }),
    ).toMatchObject({
      outcome: "command_timeout",
      terminal: true,
    });
  });
});
