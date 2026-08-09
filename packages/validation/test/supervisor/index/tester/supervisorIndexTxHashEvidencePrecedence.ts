import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_TRANSACTION_COMMITTED,
  BOT_TRANSACTION_FAILED,
  CLASSIFICATION_SUITE,
  FRESH_MATCHABLE_ORDER,
  MALFORMED_JSON_LINE,
  TRANSACTION_CONFIRMATION_TIMEOUT,
  botEvent,
  commandResult,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("reports spawn errors before generic actor exit classification", () => {
    expect(
      classifyActorResult("preflight", {
        ...commandResult("preflight", ""),
        spawnError: "ENOENT",
        status: null,
      }),
    ).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "preflight failed to spawn: ENOENT",
    });
    expect(
      classifyActorResult("bot", {
        ...commandResult("bot", ""),
        spawnError: "ENOENT",
        status: null,
      }),
    ).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "bot failed to spawn: ENOENT",
    });
    expect(
      classifyActorResult("tester", {
        ...commandResult("tester", ""),
        spawnError: "ENOENT",
        status: null,
      }),
    ).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: "tester failed to spawn: ENOENT",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("preserves accepted tx hashes in generic early classifications", () => {
    expect(
      classifyActorResult("tester", {
        ...commandResult("tester", JSON.stringify({ txHash: txHash("50") })),
        timedOut: true,
      }),
    ).toMatchObject({
      outcome: "command_timeout",
      txHashes: [txHash("50")],
    });
    expect(
      classifyActorResult("bot", {
        ...commandResult(
          "bot",
          JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("51") })),
        ),
        spawnError: "ENOENT",
        status: null,
      }),
    ).toMatchObject({
      outcome: "nonzero_exit",
      txHashes: [txHash("51")],
    });
    expect(
      classifyActorResult("bot", {
        ...commandResult(
          "bot",
          JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("52") })),
        ),
        stdoutTruncated: true,
      }),
    ).toMatchObject({
      outcome: "malformed_evidence",
      txHashes: [txHash("52")],
    });
    expect(
      classifyActorResult(
        "tester",
        commandResult(
          "tester",
          [JSON.stringify({ txHash: txHash("53") }), MALFORMED_JSON_LINE].join("\n"),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      txHashes: [txHash("53")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("preserves accepted preflight tx hashes in generic early classifications", () => {
    expect(
      classifyActorResult("preflight", {
        ...commandResult(
          "preflight",
          JSON.stringify(
            { txHash: txHash("54"), bounded: true, maxIterations: 1 },
            null,
            2,
          ),
        ),
        timedOut: true,
      }),
    ).toMatchObject({
      outcome: "command_timeout",
      txHashes: [txHash("54")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not preserve conflicted tx hashes in generic early classifications", () => {
    expect(
      classifyActorResult("tester", {
        ...commandResult(
          "tester",
          JSON.stringify({
            txHash: txHash("56"),
            error: { txHash: txHash("57") },
          }),
        ),
        timedOut: true,
      }),
    ).toMatchObject({
      outcome: "command_timeout",
      txHashes: [],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects bot post-broadcast failures with mismatched tx hash evidence", () => {
    const stdout = JSON.stringify(
      botEvent(BOT_TRANSACTION_FAILED, {
        phase: "confirmation",
        outcome: "confirmation_failed",
        status: "unresolved",
        txHash: txHash("58"),
        error: { txHash: txHash("59") },
      }),
    );

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot post-broadcast transaction failure evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects tester skips with mismatched tx hash evidence", () => {
    const stdout = JSON.stringify({
      txHash: txHash("5a"),
      skip: { reason: FRESH_MATCHABLE_ORDER, txHash: txHash("5b") },
    });

    expect(classifyActorResult("tester", commandResult("tester", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "tester skip evidence contained mismatched tx hashes",
      txHashes: [],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("keeps tester confirmation timeouts classified by safety evidence despite exit code 2", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          txHash: txHash("aa"),
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            txHash: txHash("aa"),
            status: "sent",
            isTimeout: true,
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("counts matching top-level and nested tester transaction failure tx hashes once", () => {
    const result = {
      ...commandResult(
        "tester",
        JSON.stringify({
          txHash: txHash("ae"),
          error: {
            name: "TransactionConfirmationError",
            message: TRANSACTION_CONFIRMATION_TIMEOUT,
            txHash: txHash("ae"),
            isTimeout: true,
          },
        }),
      ),
      status: 2,
    };

    expect(classifyActorResult("tester", result)).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
      txHashes: [txHash("ae")],
    });
  });
});
