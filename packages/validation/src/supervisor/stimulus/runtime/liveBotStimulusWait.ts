import { open, stat } from "node:fs/promises";
import {
  consumeBotEventText,
  createBotEventScanState,
} from "../selection/liveBotStimulusEventScan.ts";
import {
  BOT_CHAIN_PREFLIGHT_EVENT,
  MAX_EVENT_READ_BYTES,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  BotEventScanState,
  Dependencies,
  EventFileCursor,
  LiveBotWaitResult,
  ParsedStimulusArgs,
} from "../shared/liveBotStimulusTypes.ts";
import {
  isRecord,
  now,
  sleepMs,
  throwIfInterrupted,
} from "../shared/liveBotStimulusUtils.ts";

/**
 * Polls live bot events until correlated match and later quiescence or failure.
 */
export async function waitForLiveBotQuiescence(
  ...[
    eventsPath,
    baseline,
    args,
    requiredOrderTxHash,
    proveLauncher,
    dependencies,
    expectedRunId,
  ]: [
    eventsPath: string,
    baseline: EventFileCursor,
    args: ParsedStimulusArgs,
    requiredOrderTxHash: string | undefined,
    proveLauncher: () => Promise<void>,
    dependencies: Dependencies,
    expectedRunId?: string,
  ]
): Promise<LiveBotWaitResult> {
  const startedAt = now(dependencies);
  const deadline =
    args.waitSeconds === undefined ? undefined : startedAt + args.waitSeconds * 1000;
  const scan = createBotEventScanState(
    baseline.offset,
    requiredOrderTxHash,
    expectedRunId,
  );
  scan.fileIdentity = baseline.fileIdentity;
  scan.lastEventLine = baseline.lastEventLine;
  for (;;) {
    throwIfInterrupted(dependencies);
    const beforeProof = deadlineResult(deadline, scan, startedAt, dependencies);
    if (beforeProof !== undefined) {
      return beforeProof;
    }
    await proveLauncher();
    const beforeScan = deadlineResult(deadline, scan, startedAt, dependencies);
    if (beforeScan !== undefined) {
      return beforeScan;
    }
    // Local stat/open/read calls are not preemptible; the post-scan check rejects late evidence.
    await scanNewBotEvents(eventsPath, scan, dependencies);
    const afterScan = deadlineResult(deadline, scan, startedAt, dependencies);
    if (afterScan !== undefined) {
      return afterScan;
    }
    const failure = observedFailure(scan, startedAt, dependencies);
    if (failure !== undefined) {
      return failure;
    }
    const quiescent = await quiescentResult({
      scan,
      startedAt,
      deadline,
      proveLauncher,
      dependencies,
    });
    if (quiescent !== undefined) {
      return quiescent;
    }
    const sleepDuration =
      deadline === undefined
        ? args.pollSeconds * 1000
        : Math.min(args.pollSeconds * 1000, Math.max(0, deadline - now(dependencies)));
    await sleepMs(sleepDuration, dependencies);
    throwIfInterrupted(dependencies);
  }
}

function observedFailure(
  scan: BotEventScanState,
  startedAt: number,
  dependencies: Dependencies,
): LiveBotWaitResult | undefined {
  let reason: string | undefined;
  if (scan.malformedLineCount > 0) {
    reason = "live bot emitted malformed event evidence after tester stimulus";
  } else if (scan.latestFailure !== undefined) {
    reason = "live bot emitted transaction or iteration failure after tester stimulus";
  }
  return reason === undefined
    ? undefined
    : { status: "failed", elapsedMs: now(dependencies) - startedAt, reason, scan };
}

async function quiescentResult(context: {
  scan: BotEventScanState;
  startedAt: number;
  deadline: number | undefined;
  proveLauncher: () => Promise<void>;
  dependencies: Dependencies;
}): Promise<LiveBotWaitResult | undefined> {
  const { scan, startedAt, deadline, proveLauncher, dependencies } = context;
  if (scan.match === undefined || scan.quiescenceSkip === undefined) {
    return undefined;
  }
  await proveLauncher();
  const timedOut = deadlineResult(deadline, scan, startedAt, dependencies);
  return (
    timedOut ?? {
      status: "quiescent",
      elapsedMs: now(dependencies) - startedAt,
      evidence: scan.match,
      quiescence: {
        skipped: scan.quiescenceSkip,
        postMatchCommitCount: scan.postMatchCommitCount,
        ...(scan.postMatchCommitCount === 0 ? {} : { latestCommit: scan.latestCommit }),
      },
      scan,
    }
  );
}

async function scanNewBotEvents(
  eventsPath: string,
  scan: BotEventScanState,
  dependencies: Dependencies,
): Promise<void> {
  const statFn = dependencies.stat ?? stat;
  const stats = await statFn(eventsPath);
  const identity = fileIdentity(stats);
  const scanState = scan;
  const rotated =
    stats.size < scanState.offset ||
    (identity !== undefined &&
      scanState.fileIdentity !== undefined &&
      identity !== scanState.fileIdentity);
  if (!rotated) {
    scanState.fileIdentity ??= identity;
    if (stats.size === scanState.offset) {
      return;
    }
  }
  const start = rotated ? 0 : scanState.offset;
  const byteCount = stats.size - start;
  if (byteCount > MAX_EVENT_READ_BYTES) {
    throw new Error(
      `live bot event delta exceeded ${String(MAX_EVENT_READ_BYTES)} bytes; inspect ${eventsPath}`,
    );
  }
  const range = await readRange(eventsPath, start, stats.size, dependencies);
  let bytes = range.bytes;
  if (rotated) {
    const retainedPrefixBytes = retainedRotationPrefix(
      bytes,
      scanState.expectedRunId,
      scanState.lastEventLine,
    );
    resetCursorForRotatedFile(scanState, identity, retainedPrefixBytes);
    bytes = bytes.subarray(retainedPrefixBytes);
  }
  const text = scanState.decoder.decode(bytes, { stream: true });
  consumeBotEventText(scanState, text, range.nextOffset);
}

async function readRange(
  filePath: string,
  start: number,
  end: number,
  dependencies: Dependencies,
): Promise<{ bytes: Buffer; nextOffset: number }> {
  const openFn = dependencies.open ?? open;
  const handle = await openFn(filePath, "r");
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        length - bytesRead,
        start + bytesRead,
      );
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    return {
      bytes: buffer.subarray(0, bytesRead),
      nextOffset: start + bytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function eventFileCursor(
  filePath: string,
  dependencies: Dependencies,
): Promise<EventFileCursor> {
  const statFn = dependencies.stat ?? stat;
  const stats = await statFn(filePath);
  const identity = fileIdentity(stats);
  const lastEventLine = await baselineLastEventLine(filePath, stats.size, dependencies);
  return {
    offset: stats.size,
    ...(identity === undefined ? {} : { fileIdentity: identity }),
    ...(lastEventLine === undefined ? {} : { lastEventLine }),
  };
}

async function baselineLastEventLine(
  filePath: string,
  size: number,
  dependencies: Dependencies,
): Promise<string | undefined> {
  if (size === 0) {
    return undefined;
  }
  const start = Math.max(0, size - MAX_EVENT_READ_BYTES);
  const { bytes } = await readRange(filePath, start, size, dependencies);
  const text = bytes.toString("utf8");
  const lines = text.split(/\n/u);
  if (!text.endsWith("\n")) {
    lines.pop();
  }
  if (start > 0) {
    lines.shift();
  }
  const line = lines.findLast((candidate) => candidate.trim() !== "");
  return line?.replace(/\r$/u, "");
}

function fileIdentity(stats: {
  dev?: bigint | number;
  ino?: bigint | number;
}): string | undefined {
  return stats.dev === undefined || stats.ino === undefined
    ? undefined
    : `${String(stats.dev)}:${String(stats.ino)}`;
}

function resetCursorForRotatedFile(
  scan: BotEventScanState,
  nextIdentity: string | undefined,
  offset: number,
): void {
  Object.assign(scan, {
    offset,
    pendingText: "",
    decoder: new TextDecoder(),
    fileIdentity: nextIdentity,
  });
}

function retainedRotationPrefix(
  bytes: Buffer,
  expectedRunId: string | undefined,
  lastEventLine: string | undefined,
): number {
  const newline = bytes.indexOf(0x0a);
  if (newline === -1) {
    throw new Error("rotated live bot event log lacks a complete run identity line");
  }
  let first: unknown;
  try {
    first = JSON.parse(bytes.subarray(0, newline).toString("utf8").trimEnd());
  } catch {
    throw new Error("rotated live bot event log starts with malformed run evidence");
  }
  if (
    !isRecord(first) ||
    first["app"] !== "bot" ||
    expectedRunId === undefined ||
    first["runId"] !== expectedRunId
  ) {
    throw new Error("rotated live bot event log belongs to another launcher runId");
  }
  const identityBytes = first["type"] === BOT_CHAIN_PREFLIGHT_EVENT ? newline + 1 : 0;
  const retainedEnd = bytes.indexOf(0x0a, identityBytes);
  if (
    lastEventLine !== undefined &&
    retainedEnd !== -1 &&
    bytes.subarray(identityBytes, retainedEnd).toString("utf8").replace(/\r$/u, "") ===
      lastEventLine
  ) {
    return retainedEnd + 1;
  }
  return identityBytes;
}

export function waitSummary(result: LiveBotWaitResult): Record<string, unknown> {
  return result.status === "quiescent"
    ? {
        status: result.status,
        elapsedMs: result.elapsedMs,
        evidence: result.evidence,
        quiescence: result.quiescence,
        scan: scanSummary(result.scan),
      }
    : {
        status: result.status,
        elapsedMs: result.elapsedMs,
        reason: result.reason,
        scan: scanSummary(result.scan),
      };
}

function scanSummary(scan: BotEventScanState): Record<string, unknown> {
  return {
    offset: scan.offset,
    acceptedEventCount: scan.acceptedEventCount,
    malformedLineCount: scan.malformedLineCount,
    latestEvent: scan.latestEvent ?? null,
    latestSkip: scan.latestSkip ?? null,
    latestCommit: scan.latestCommit ?? null,
    latestFailure: scan.latestFailure ?? null,
    latestMatchedOrderFailure: scan.latestMatchedOrderFailure ?? null,
    quiescenceSkip: scan.quiescenceSkip ?? null,
    postMatchCommitCount: scan.postMatchCommitCount,
  };
}

function deadlineFailure(
  scan: BotEventScanState,
  startedAt: number,
  dependencies: Dependencies,
): LiveBotWaitResult {
  return {
    status: "failed",
    elapsedMs: now(dependencies) - startedAt,
    reason:
      scan.match === undefined
        ? "timed out waiting for live bot matched-order commit"
        : "timed out waiting for live bot quiescence after matched-order commit",
    scan,
  };
}

function deadlineResult(
  deadline: number | undefined,
  scan: BotEventScanState,
  startedAt: number,
  dependencies: Dependencies,
): LiveBotWaitResult | undefined {
  return deadline !== undefined && now(dependencies) >= deadline
    ? deadlineFailure(scan, startedAt, dependencies)
    : undefined;
}
