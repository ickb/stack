import { expect, it } from "vitest";

import {
  boundedText,
  classifyTesterResult,
  emptyActions,
  isTesterFundingError,
  lastRecordOfTypes,
  parseJsonEvidence,
  parsePreflightEvidence,
  retryableBotFailures,
  testerOrderEvidence,
  validateTesterEvidenceExpectation,
} from "../../../../src/supervisor/index.ts";
import { txHash } from "../../support/supervisor/index.ts";
import { classificationBase, commandResult, sparseRecords } from "./support.ts";

const CKB_TO_ICKB_DIRECTION = "ckb-to-ickb";
const MIXED_DIRECTION_SCENARIO = "mixed-direction-limit-orders";
const MULTI_ORDER_SCENARIO = "multi-order-limit-orders";
const RANDOM_ORDER_SCENARIO = "random-order";
const TWO_CKB_TO_ICKB_SCENARIO = "two-ckb-to-ickb-limit-orders";
const WRONG_ORDER_DIRECTION = "wrong order direction";

it("covers tester classification error, skip, and commit branches", () => {
  const base = classificationBase("tester");
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      { records: [], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({
    outcome: "unknown",
  });
  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      { records: [{ txHash: txHash("aa") }], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({ outcome: "nonzero_exit", txHashes: [txHash("aa")] });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      { records: [{ error: "Not enough iCKB" }], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({ outcome: "low_capital_stop" });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [{ error: { message: "deterministic" } }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({
    outcome: "tester_deterministic_pre_broadcast_error",
  });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      { records: [{ skip: {} }], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({ outcome: "unknown", skipReason: "unknown" });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [{ skip: { reason: "post-tx-ckb-reserve" } }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({
    outcome: "tester_reserve_skip",
  });
});

it("covers tester commit branches", () => {
  const base = classificationBase("tester");
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [{ txHash: "bad" }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [
          { txHash: txHash("12"), actions: { conversion: { kind: "ckb-to-ickb" } } },
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "tester_conversion_created" });
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      { records: [{ txHash: txHash("13") }], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
});

it("covers evidence parsing and classifier utility branches", () => {
  expect(parsePreflightEvidence("[1]").malformedLines).toEqual(["[1]"]);
  expect(parsePreflightEvidence("{bad").malformedLines).toEqual(["{bad"]);
  expect(parseJsonEvidence('{"items":[]}\nplain\n{}').malformedLines).toEqual([]);
  expect(parseJsonEvidence('{"items":[]}\nplain\n{}').records).toHaveLength(2);
  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      {
        records: [{ txHash: txHash("01") }, { txHash: txHash("01") }],
        ignoredLines: [],
        malformedLines: [],
      },
      classificationBase("tester"),
    ).txHashes,
  ).toEqual([txHash("01")]);
  expect(emptyActions()).toEqual({
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  });
  expect(isTesterFundingError("Not enough CKB")).toBe(true);
  expect(isTesterFundingError({ message: "Not enough funds" })).toBe(true);
  expect(lastRecordOfTypes(sparseRecords(), ["x"])).toBeUndefined();
  expect(retryableOutPoint({ txHash: txHash("15"), index: "0" })).toEqual({
    txHash: txHash("15"),
    index: "0",
  });
  expect(retryableOutPoint({ txHash: txHash("15") })).toBeUndefined();
  expect(retryableOutPoint({ index: "0" })).toBeUndefined();
  expect(retryableOutPoint({ txHash: "bad", index: "0" })).toBeUndefined();
  expect(retryableOutPoint({ txHash: txHash("15"), index: "0.5" })).toBeUndefined();
  expect(retryableOutPoint({})).toBeUndefined();
  expect(parseJsonEvidence("[1]").ignoredLines).toEqual(["[1]"]);
  expect(parseJsonEvidence("{").malformedLines).toEqual(["{"]);
  expect(boundedText("abcdef", 3)).toBe("");
});

it("covers tester nonzero classification tx-hash filtering", () => {
  const base = classificationBase("tester");

  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      { records: [{}], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({ txHashes: [] });
  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      {
        records: [
          {
            txHash: txHash("16"),
            error: { name: "TransactionConfirmationError", txHash: txHash("17") },
          },
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ txHashes: [] });
  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      {
        records: [{ txHash: txHash("18"), skip: { txHash: txHash("19") } }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "nonzero_exit", txHashes: [] });
  expect(
    classifyTesterResult(
      commandResult("tester", "", { status: 2 }),
      {
        records: [{ error: { retryable: true, terminal: false } }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "nonzero_exit", terminal: true });
});

it("covers tester single-order evidence validation branches", () => {
  const base = classificationBase("tester");

  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [
          {
            txHash: txHash("14"),
            actions: { newOrder: { giveCkb: "1", takeIckb: "2" } },
          },
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ testerOrder: { orders: [{ direction: CKB_TO_ICKB_DIRECTION }] } });
  expect(
    testerOrderEvidence({
      requestedTesterScenario: "auto",
      testerScenario: RANDOM_ORDER_SCENARIO,
      cancelledOrders: 1,
      collectedOrders: 1,
      newOrders: [{ giveCkb: "1", takeIckb: "2" }],
    }),
  ).toMatchObject({
    collectedOrders: 1,
    cancelledOrders: 1,
    orders: [{ direction: CKB_TO_ICKB_DIRECTION }],
  });
  expect(
    testerOrderEvidence({
      newOrders: [undefined, { giveCkb: "1", takeIckb: "2" }],
    }),
  ).toBeUndefined();
  expect(testerOrderEvidence({ newOrder: {} })).toBeUndefined();
});

it("covers tester single-order expectation branches", () => {
  const base = classificationBase("tester");
  expect(
    validateTesterEvidenceExpectation(undefined, { scenario: RANDOM_ORDER_SCENARIO }),
  ).toContain("without actions");
  expect(
    validateTesterEvidenceExpectation({}, { scenario: RANDOM_ORDER_SCENARIO }),
  ).toContain("scenario unknown");
  expect(
    validateTesterEvidenceExpectation(
      { testerScenario: RANDOM_ORDER_SCENARIO },
      { scenario: RANDOM_ORDER_SCENARIO },
    ),
  ).toContain("without new order");
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: RANDOM_ORDER_SCENARIO,
        newOrder: { giveIckb: "1", takeCkb: "2" },
      },
      { scenario: RANDOM_ORDER_SCENARIO },
    ),
  ).toBeUndefined();
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: RANDOM_ORDER_SCENARIO,
        newOrder: {
          giveCkb: "1",
          takeIckb: "2",
          giveIckb: "3",
          takeCkb: "4",
        },
      },
      { scenario: RANDOM_ORDER_SCENARIO },
    ),
  ).toContain(WRONG_ORDER_DIRECTION);
  expect(
    validateTesterEvidenceExpectation(
      { testerScenario: RANDOM_ORDER_SCENARIO, newOrder: {} },
      { scenario: RANDOM_ORDER_SCENARIO },
    ),
  ).toContain(WRONG_ORDER_DIRECTION);
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: "all-ckb-limit-order",
        newOrder: { giveIckb: "1", takeCkb: "2" },
      },
      { scenario: "all-ckb-limit-order" },
    ),
  ).toContain(WRONG_ORDER_DIRECTION);
  expect(
    classifyTesterResult(
      commandResult("tester", ""),
      {
        records: [
          {
            txHash: txHash("1a"),
            actions: {
              newOrder: { giveCkb: "1", takeIckb: "2", giveIckb: "3", takeCkb: "4" },
            },
          },
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
});

it("covers tester multi-order evidence validation branches", () => {
  expect(
    validateTesterEvidenceExpectation(
      { testerScenario: TWO_CKB_TO_ICKB_SCENARIO, newOrders: [], orderCount: 0 },
      { scenario: MULTI_ORDER_SCENARIO },
    ),
  ).toContain("without 2");
  expect(
    validateTesterEvidenceExpectation(
      { testerScenario: "unknown" },
      { scenario: MULTI_ORDER_SCENARIO },
    ),
  ).toContain("non-multi-order");
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: TWO_CKB_TO_ICKB_SCENARIO,
        newOrders: [
          { giveCkb: "1", takeIckb: "2" },
          { giveCkb: "3", takeIckb: "4" },
        ],
        orderCount: 1,
      },
      { scenario: TWO_CKB_TO_ICKB_SCENARIO },
    ),
  ).toContain("wrong order count");
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: TWO_CKB_TO_ICKB_SCENARIO,
        newOrders: [
          { giveCkb: "1", takeIckb: "2", giveIckb: "3", takeCkb: "4" },
          { giveCkb: "5", takeIckb: "6" },
        ],
        orderCount: 2,
      },
      { scenario: TWO_CKB_TO_ICKB_SCENARIO },
    ),
  ).toContain(WRONG_ORDER_DIRECTION);
  expect(
    validateTesterEvidenceExpectation(
      { testerScenario: MIXED_DIRECTION_SCENARIO, newOrders: [], orderCount: 0 },
      { scenario: MIXED_DIRECTION_SCENARIO },
    ),
  ).toContain("without 2");
  expect(
    validateTesterEvidenceExpectation(
      {
        testerScenario: MIXED_DIRECTION_SCENARIO,
        newOrders: [
          { giveCkb: "1", takeIckb: "2" },
          { giveIckb: "3", takeCkb: "4" },
        ],
        orderCount: 1,
      },
      { scenario: MIXED_DIRECTION_SCENARIO },
    ),
  ).toContain("wrong order count");
});

function retryableOutPoint(
  outPoint: Record<string, unknown>,
): { txHash: string; index: string } | undefined {
  return retryableBotFailures([
    {
      type: "bot.transaction.failed",
      retryable: true,
      terminal: false,
      error: { outPoint },
    },
  ])?.[0]?.outPoint;
}
