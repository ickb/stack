import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  CLASSIFICATION_SUITE,
  PREFLIGHT_RETRYABLE_FAILURE,
  botEvent,
  commandResult,
  emptyActions,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("requires preflight configs to bound actors to one iteration", () => {
    expect(
      classifyActorResult(
        "preflight",
        commandResult(
          "preflight",
          JSON.stringify({
            chain: "testnet",
            bounded: false,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight config is not bounded to one iteration",
    });
    expect(
      classifyActorResult(
        "preflight",
        commandResult(
          "preflight",
          JSON.stringify({
            chain: "testnet",
            bounded: true,
            maxIterations: 2,
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "preflight config is not bounded to one iteration",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("fails closed when captured command output is truncated", () => {
    expect(
      classifyActorResult("bot", {
        ...commandResult(
          "bot",
          JSON.stringify(
            botEvent(BOT_DECISION_SKIPPED, {
              reason: "no_actions",
              actions: emptyActions(),
            }),
          ),
        ),
        stdoutTruncated: true,
      }),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stdout evidence exceeded supervisor capture limit",
      evidence: { stdoutTruncated: true },
    });
    expect(
      classifyActorResult("preflight", {
        ...commandResult(
          "preflight",
          JSON.stringify({ chain: "testnet", bounded: true, maxIterations: 1 }),
        ),
        stderrTruncated: true,
      }),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "stderr evidence exceeded supervisor capture limit",
      evidence: { stderrTruncated: true },
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("preserves transaction-shaped preflight stderr for artifact capture", () => {
    const classification = classifyActorResult("preflight", {
      ...commandResult("preflight", "{}"),
      status: 1,
      stderr: JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    });

    expect(classification).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: JSON.stringify({ witnesses: ["0xsignature"], inputs: [] }),
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("preserves snake_case CKB transaction fields for artifact capture", () => {
    const classification = classifyActorResult("preflight", {
      ...commandResult("preflight", "{}"),
      status: 1,
      stderr: JSON.stringify({
        cell_deps: [],
        header_deps: [],
        outputs_data: ["0x"],
      }),
    });

    expect(classification).toMatchObject({
      outcome: "nonzero_exit",
      terminal: true,
      reason: JSON.stringify({
        cell_deps: [],
        header_deps: [],
        outputs_data: ["0x"],
      }),
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies retryable preflight transport failures separately", () => {
    expect(
      classifyActorResult("preflight", {
        ...commandResult("preflight", ""),
        status: 1,
        stderr: PREFLIGHT_RETRYABLE_FAILURE,
      }),
    ).toMatchObject({
      outcome: "preflight_retryable_error",
      terminal: true,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies preserved wrong-chain preflight evidence", () => {
    expect(
      classifyActorResult("preflight", {
        ...commandResult("preflight", ""),
        status: 1,
        stderr:
          "Live preflight failed: Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2\n",
      }),
    ).toMatchObject({
      outcome: "wrong_chain",
      terminal: true,
    });
    expect(
      classifyActorResult("preflight", {
        ...commandResult("preflight", ""),
        status: 1,
        stderr: "Live preflight failed: Missing testnet genesis header\n",
      }),
    ).toMatchObject({
      outcome: "wrong_chain",
      terminal: true,
    });
  });
});
