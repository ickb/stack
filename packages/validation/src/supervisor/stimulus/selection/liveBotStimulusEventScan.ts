import {
  isNonNegativeSafeInteger,
  isOutputIndex,
} from "../../runtime/shared/supervisorEvidence.ts";
import {
  BOT_DECISION_SKIPPED_EVENT,
  BOT_ITERATION_FAILED_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  BOT_TRANSACTION_FAILED_EVENT,
  MAX_PENDING_EVENT_TEXT_BYTES,
  MAX_UNMATCHED_ITERATIONS,
  PUBLIC_STATE_FIELDS,
  TESTER_ORDER_CREATED,
  TX_HASH_PATTERN,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  BotEventScanState,
  LiveBotMatchedOrderFailureEvidence,
  LiveBotMatchEvidence,
} from "../shared/liveBotStimulusTypes.ts";
import {
  isRecord,
  numberField,
  optionalNumberField,
  optionalStringField,
  recordField,
  stringField,
} from "../shared/liveBotStimulusUtils.ts";

interface EvidenceOutPoint {
  txHash: string;
  index: string;
}

interface AcceptedBotEvent extends Record<string, unknown> {
  iterationId: number;
  runId: string;
  type: string;
}

interface AcceptedBuiltBotEvent extends AcceptedBotEvent {
  actions: Record<string, unknown> & { matchedOrders: number };
  type: typeof BOT_TRANSACTION_BUILT_EVENT;
}

export function createBotEventScanState(
  offset = 0,
  requiredOrderTxHash?: string,
  expectedRunId?: string,
): BotEventScanState {
  return {
    offset,
    decoder: new TextDecoder(),
    pendingText: "",
    acceptedEventCount: 0,
    malformedLineCount: 0,
    matchedBuiltByIteration: new Map(),
    committedByIteration: new Map(),
    postMatchCommitCount: 0,
    ...(requiredOrderTxHash === undefined
      ? {}
      : { requiredOrderTxHash: normalizeTxHash(requiredOrderTxHash) }),
    ...(expectedRunId === undefined ? {} : { expectedRunId }),
  };
}

export function consumeBotEventText(
  state: BotEventScanState,
  text: string,
  nextOffset: number,
): BotEventScanState {
  const combined = state.pendingText + text;
  const lines = combined.split("\n");
  // JSONL chunks can end mid-record, so defer the final partial line until the next read.
  Object.assign(state, {
    pendingText: combined.endsWith("\n") ? "" : lines.splice(-1, 1).join(""),
    offset: nextOffset,
  });
  if (Buffer.byteLength(state.pendingText) > MAX_PENDING_EVENT_TEXT_BYTES) {
    Object.assign(state, {
      pendingText: "",
      malformedLineCount: state.malformedLineCount + 1,
    });
  }
  for (const rawLine of lines) {
    consumeBotEventLine(state, rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine);
  }
  return state;
}

function consumeBotEventLine(state: BotEventScanState, line: string): void {
  if (line.trim() === "") {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    markMalformed(state);
    return;
  }
  if (
    !isRecord(parsed) ||
    parsed["app"] !== "bot" ||
    (state.expectedRunId !== undefined && parsed["runId"] !== state.expectedRunId) ||
    !isAcceptedBotEvent(parsed)
  ) {
    markMalformed(state);
    return;
  }
  const summary = publicBotEventSummary(parsed);
  Object.assign(state, {
    acceptedEventCount: state.acceptedEventCount + 1,
    lastEventLine: line,
    latestEvent: summary,
  });
  observeBotEvent(state, parsed);
}

function markMalformed(state: BotEventScanState): void {
  Object.assign(state, { malformedLineCount: state.malformedLineCount + 1 });
}

function observeBotEvent(state: BotEventScanState, event: AcceptedBotEvent): void {
  const { type } = event;
  const key = iterationKey(event);
  Object.assign(state, { quiescenceSkip: undefined });
  if (type === BOT_TRANSACTION_FAILED_EVENT || type === BOT_ITERATION_FAILED_EVENT) {
    observeRetryableMatchedOrderFailure(state, event, key);
    Object.assign(state, { latestFailure: publicFailureSummary(event) });
    return;
  }
  if (
    observeBuiltTransaction(state, event, key) ||
    observeCommittedTransaction(state, event, key)
  ) {
    return;
  }
  if (type === BOT_DECISION_SKIPPED_EVENT) {
    const summary = publicBotEventSummary(event);
    Object.assign(state, {
      latestSkip: summary,
      ...(state.match !== undefined &&
      isLaterIteration(event, state.match) &&
      hasNoOutstandingOrders(summary)
        ? { quiescenceSkip: summary }
        : {}),
    });
  }
}

function hasNoOutstandingOrders(event: Record<string, unknown>): boolean {
  const orders = recordField(recordField(event, "state"), "orders");
  return orders?.["marketCount"] === 0 && orders["receiptCount"] === 0;
}

function observeBuiltTransaction(
  state: BotEventScanState,
  event: AcceptedBotEvent,
  key: string,
): boolean {
  if (!isAcceptedBuiltBotEvent(event) || event.actions.matchedOrders <= 0) {
    return false;
  }
  const summary = publicBotEventSummary(event);
  const committed = state.committedByIteration.get(key);
  if (committed === undefined) {
    rememberUnmatched(state.matchedBuiltByIteration, key, summary, state);
    return true;
  }
  const match = matchEvidence(summary, committed, state);
  clearIterationEvidence(state, key);
  if (state.match === undefined && match !== undefined) {
    Object.assign(state, { match });
  }
  return true;
}

function observeCommittedTransaction(
  state: BotEventScanState,
  event: AcceptedBotEvent,
  key: string,
): boolean {
  if (event.type !== BOT_TRANSACTION_COMMITTED_EVENT) {
    return false;
  }
  const summary = publicBotEventSummary(event);
  const afterMatch = state.match !== undefined;
  Object.assign(state, { latestCommit: summary });
  if (afterMatch) {
    Object.assign(state, { postMatchCommitCount: state.postMatchCommitCount + 1 });
  }
  const built = state.matchedBuiltByIteration.get(key);
  if (built === undefined) {
    rememberUnmatched(state.committedByIteration, key, summary, state);
    return true;
  }
  const match = matchEvidence(built, summary, state);
  clearIterationEvidence(state, key);
  if (state.match === undefined && match !== undefined) {
    Object.assign(state, { match });
  }
  return true;
}

function observeRetryableMatchedOrderFailure(
  state: BotEventScanState,
  event: AcceptedBotEvent,
  key: string,
): boolean {
  if (!isRetryableNonTerminalBotFailureEvent(event)) {
    return false;
  }
  const built = state.matchedBuiltByIteration.get(key);
  const evidence =
    built === undefined ? undefined : matchedOrderFailureEvidence(built, event, state);
  if (evidence !== undefined) {
    Object.assign(state, { latestMatchedOrderFailure: evidence });
  }
  clearIterationEvidence(state, key);
  return true;
}

function isRetryableNonTerminalBotFailureEvent(event: Record<string, unknown>): boolean {
  return event["retryable"] === true && event["terminal"] === false;
}

function matchEvidence(
  built: Record<string, unknown>,
  committed: Record<string, unknown>,
  state: BotEventScanState,
): LiveBotMatchEvidence | undefined {
  const runId = stringField(committed, "runId");
  const iterationId = numberField(committed, "iterationId");
  const txHash = normalizedTxHashField(committed, "txHash");
  const matchedOrderOutPoints = matchedOrderOutPointsFromBuilt(built);
  const matchedOrderMasterOutPoints = matchedOrderMasterOutPointsFromBuilt(built);
  if (
    runId === undefined ||
    iterationId === undefined ||
    txHash === undefined ||
    !hasRequiredOrderEvidence(state, {
      matchedOrderOutPoints,
      matchedOrderMasterOutPoints,
    })
  ) {
    return undefined;
  }
  return {
    runId,
    iterationId,
    txHash,
    matchedOrderOutPoints,
    matchedOrderMasterOutPoints,
    ...(state.requiredOrderTxHash === undefined
      ? {}
      : { requiredOrderTxHash: state.requiredOrderTxHash }),
    built,
    committed,
  };
}

function matchedOrderFailureEvidence(
  built: Record<string, unknown>,
  failure: Record<string, unknown>,
  state: BotEventScanState,
): LiveBotMatchedOrderFailureEvidence | undefined {
  const runId = stringField(failure, "runId");
  const iterationId = numberField(failure, "iterationId");
  const matchedOrderOutPoints = matchedOrderOutPointsFromBuilt(built);
  const matchedOrderMasterOutPoints = matchedOrderMasterOutPointsFromBuilt(built);
  if (
    runId === undefined ||
    iterationId === undefined ||
    !hasRequiredOrderEvidence(state, {
      matchedOrderOutPoints,
      matchedOrderMasterOutPoints,
    })
  ) {
    return undefined;
  }
  return {
    runId,
    iterationId,
    matchedOrderOutPoints,
    matchedOrderMasterOutPoints,
    ...(state.requiredOrderTxHash === undefined
      ? {}
      : { requiredOrderTxHash: state.requiredOrderTxHash }),
    built,
    failure: publicFailureSummary(failure),
  };
}

function hasRequiredOrderEvidence(
  state: BotEventScanState,
  outPoints: {
    matchedOrderOutPoints: Array<{ txHash: string; index: string }>;
    matchedOrderMasterOutPoints: Array<{ txHash: string; index: string }>;
  },
): boolean {
  if (state.requiredOrderTxHash === undefined) {
    return true;
  }
  for (const outPoint of [
    ...outPoints.matchedOrderOutPoints,
    ...outPoints.matchedOrderMasterOutPoints,
  ]) {
    if (state.requiredOrderTxHash === outPoint.txHash) {
      return true;
    }
  }
  return false;
}

function publicFailureSummary(event: Record<string, unknown>): Record<string, unknown> {
  const summary = publicBotEventSummary(event);
  return event["error"] === undefined ? summary : { ...summary, error: event["error"] };
}

function publicBotEventSummary(event: Record<string, unknown>): Record<string, unknown> {
  const matchedOrderOutPoints = matchedOrderOutPointsFromEvent(event);
  const matchedOrderMasterOutPoints = matchedOrderMasterOutPointsFromEvent(event);
  const state = publicStateFromEvent(event);
  return {
    ...optionalStringField(event, "type"),
    ...optionalStringField(event, "timestamp"),
    ...optionalStringField(event, "runId"),
    ...optionalNumberField(event, "iterationId"),
    ...(normalizedTxHashField(event, "txHash") === undefined
      ? {}
      : { txHash: normalizedTxHashField(event, "txHash") }),
    ...optionalStringField(event, "outcome"),
    ...optionalStringField(event, "phase"),
    ...(event["terminal"] === undefined ? {} : { terminal: event["terminal"] }),
    ...(event["retryable"] === undefined ? {} : { retryable: event["retryable"] }),
    ...optionalStringField(event, "reason"),
    ...(recordField(event, "actions") === undefined
      ? {}
      : { actions: recordField(event, "actions") }),
    ...(matchedOrderOutPoints.length === 0 ? {} : { matchedOrderOutPoints }),
    ...(matchedOrderMasterOutPoints.length === 0 ? {} : { matchedOrderMasterOutPoints }),
    ...(state === undefined ? {} : { state }),
  };
}

function publicStateFromEvent(
  event: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const decision = recordField(event, "decision");
  const state: Record<string, unknown> = {};
  for (const field of PUBLIC_STATE_FIELDS) {
    const value = recordField(decision, field) ?? recordField(event, field);
    if (value !== undefined) {
      state[field] = value;
    }
  }
  return Object.keys(state).length === 0 ? undefined : state;
}

const KNOWN_BOT_EVENT_TYPES = new Set([
  "bot.run.started",
  "bot.chain.preflight",
  "bot.iteration.started",
  "bot.state.read",
  "bot.match.evaluated",
  "bot.rebalance.evaluated",
  BOT_DECISION_SKIPPED_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
  "bot.transaction.sent",
  "bot.transaction.confirmation",
  BOT_TRANSACTION_COMMITTED_EVENT,
  BOT_TRANSACTION_FAILED_EVENT,
  BOT_ITERATION_FAILED_EVENT,
]);

function isAcceptedBotEvent(event: Record<string, unknown>): event is AcceptedBotEvent {
  return !hasMalformedBotEvidence(event);
}

function isAcceptedBuiltBotEvent(
  event: AcceptedBotEvent,
): event is AcceptedBuiltBotEvent {
  return event.type === BOT_TRANSACTION_BUILT_EVENT;
}

function hasMalformedBotEvidence(event: Record<string, unknown>): boolean {
  return (
    hasMalformedBotIdentity(event) ||
    hasMalformedTypedEvidence(event) ||
    hasMalformedOutPointEvidence(event)
  );
}

function hasMalformedBotIdentity(event: Record<string, unknown>): boolean {
  const chain = stringField(event, "chain");
  const runId = stringField(event, "runId");
  const iterationId = numberField(event, "iterationId");
  const timestamp = stringField(event, "timestamp");
  return (
    event["version"] !== 1 ||
    chain === undefined ||
    chain.trim() === "" ||
    runId === undefined ||
    runId.trim() === "" ||
    iterationId === undefined ||
    iterationId < 0 ||
    timestamp === undefined ||
    timestamp.trim() === ""
  );
}

function hasMalformedTypedEvidence(event: Record<string, unknown>): boolean {
  const type = stringField(event, "type");
  if (type === undefined || !KNOWN_BOT_EVENT_TYPES.has(type)) {
    return true;
  }
  const actions = recordField(event, "actions");
  const matchedOrders = actions?.["matchedOrders"];
  if (matchedOrders !== undefined && !isNonNegativeSafeInteger(matchedOrders)) {
    return true;
  }
  if (type === BOT_TRANSACTION_BUILT_EVENT) {
    return actions === undefined || !isNonNegativeSafeInteger(matchedOrders);
  }
  if (type === BOT_TRANSACTION_COMMITTED_EVENT) {
    return !TX_HASH_PATTERN.test(stringField(event, "txHash") ?? "");
  }
  return (
    (type === BOT_TRANSACTION_FAILED_EVENT || type === BOT_ITERATION_FAILED_EVENT) &&
    (typeof event["retryable"] !== "boolean" || typeof event["terminal"] !== "boolean")
  );
}

function isLaterIteration(event: AcceptedBotEvent, match: LiveBotMatchEvidence): boolean {
  return event.runId === match.runId && event.iterationId > match.iterationId;
}

function hasMalformedOutPointEvidence(event: Record<string, unknown>): boolean {
  const decision = recordField(event, "decision");
  const decisionMatch = recordField(decision, "match");
  const eventMatch = recordField(event, "match");
  return [decisionMatch, eventMatch].some(
    (record) =>
      hasMalformedOutPointArrayField(record, "matchedOrderOutPoints") ||
      hasMalformedOutPointArrayField(record, "matchedOrderMasterOutPoints"),
  );
}

function hasMalformedOutPointArrayField(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const value = record?.[key];
  if (value === undefined) {
    return false;
  }
  if (!Array.isArray(value)) {
    return true;
  }
  return outPointArrayField(record, key).length !== value.length;
}

function matchedOrderOutPointsFromBuilt(
  built: Record<string, unknown>,
): EvidenceOutPoint[] {
  return outPointArrayField(built, "matchedOrderOutPoints");
}

function matchedOrderMasterOutPointsFromBuilt(
  built: Record<string, unknown>,
): EvidenceOutPoint[] {
  return outPointArrayField(built, "matchedOrderMasterOutPoints");
}

function matchedOrderOutPointsFromEvent(
  event: Record<string, unknown>,
): EvidenceOutPoint[] {
  const decision = recordField(event, "decision");
  const decisionMatch = recordField(decision, "match");
  const eventMatch = recordField(event, "match");
  return mergeOutPointArrays(
    outPointArrayField(decisionMatch, "matchedOrderOutPoints"),
    outPointArrayField(eventMatch, "matchedOrderOutPoints"),
  );
}

function matchedOrderMasterOutPointsFromEvent(
  event: Record<string, unknown>,
): EvidenceOutPoint[] {
  const decision = recordField(event, "decision");
  const decisionMatch = recordField(decision, "match");
  const eventMatch = recordField(event, "match");
  return mergeOutPointArrays(
    outPointArrayField(decisionMatch, "matchedOrderMasterOutPoints"),
    outPointArrayField(eventMatch, "matchedOrderMasterOutPoints"),
  );
}

function mergeOutPointArrays(...arrays: EvidenceOutPoint[][]): EvidenceOutPoint[] {
  const outPoints = new Array<EvidenceOutPoint>();
  for (const array of arrays) {
    outPoints.push(...array);
  }
  return outPoints;
}

function outPointArrayField(
  record: Record<string, unknown> | undefined,
  key: string,
): EvidenceOutPoint[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const outPoints = new Array<EvidenceOutPoint>();
  for (const item of value) {
    const outPoint = outPointFromEvidence(item);
    if (outPoint !== undefined) {
      outPoints.push(outPoint);
    }
  }
  return outPoints;
}

function outPointFromEvidence(item: unknown): EvidenceOutPoint | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  const txHash = normalizedTxHashField(item, "txHash");
  const index = stringField(item, "index");
  return txHash !== undefined && isOutputIndex(index) ? { txHash, index } : undefined;
}

export function testerOrderCreatedTxHash(
  summary: Record<string, unknown> | undefined,
): string | undefined {
  const evidence = Array.isArray(summary?.["testerOrderEvidence"])
    ? summary["testerOrderEvidence"]
    : [];
  const created = evidence.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item["outcome"] === TESTER_ORDER_CREATED,
  );
  const item = created[0];
  const txHashes = item?.["txHashes"];
  const txHash: unknown = Array.isArray(txHashes) ? txHashes[0] : undefined;
  return created.length === 1 &&
    item?.["orderCount"] === 1 &&
    Array.isArray(txHashes) &&
    txHashes.length === 1 &&
    typeof txHash === "string" &&
    TX_HASH_PATTERN.test(txHash)
    ? normalizeTxHash(txHash)
    : undefined;
}

function iterationKey(event: AcceptedBotEvent): string {
  return `${event.runId}:${String(event.iterationId)}`;
}

function normalizeTxHash(txHash: string): string {
  return txHash.toLowerCase();
}

function normalizedTxHashField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = stringField(record, key);
  return value === undefined || !TX_HASH_PATTERN.test(value)
    ? undefined
    : normalizeTxHash(value);
}

function rememberUnmatched(
  map: Map<string, Record<string, unknown>>,
  key: string,
  summary: Record<string, unknown>,
  state: BotEventScanState,
): void {
  if (!map.has(key) && map.size >= MAX_UNMATCHED_ITERATIONS) {
    Object.assign(state, { malformedLineCount: state.malformedLineCount + 1 });
    return;
  }
  map.set(key, summary);
}

function clearIterationEvidence(state: BotEventScanState, key: string): void {
  state.matchedBuiltByIteration.delete(key);
  state.committedByIteration.delete(key);
}
