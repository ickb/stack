import {
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  type Actor,
} from "../shared/supervisorConstants.ts";
import type { CommandResult } from "../shared/supervisorTypes.ts";

export function sampleCommandResult(actor: Actor, stdout: string): CommandResult {
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
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_SECONDS * 1000,
  };
}

export function dryRunBotEvent(
  type: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "dry-run",
    iterationId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    ...fields,
  };
}

export function sampleTransactionHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}
