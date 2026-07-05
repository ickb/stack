import process from "node:process";

const UNKNOWN_ERROR_MESSAGE = "Unknown error";
const MESSAGE_KEY = "message";
const CIRCULAR_LOG_VALUE = "[Circular]";
const UNSAFE_LOG_VALUE = "[Unsupported log value]";
const ERROR_BUILTIN_KEYS = new Set(["name", "message", "stack", "cause"]);

/** Process exit code used when a loop stops after a confirmation timeout. */
export const STOP_EXIT_CODE = 2;

type JsonLogPrimitive = string | number | boolean | symbol | null | undefined;

/** JSON-line-safe value after log normalization. */
export type JsonLogValue = JsonLogPrimitive | JsonLogValue[] | JsonLogRecord;

interface JsonLogRecord {
  [key: string]: JsonLogValue;
}

/**
 * Records a JSON-safe error on the execution log and returns true when the loop should stop.
 */
export function handleLoopError(
  executionLog: Record<string, unknown>,
  error: unknown,
): boolean {
  const log = executionLog;
  log["error"] = errorToLog(error);
  if (shouldStopAfterError(error)) {
    process.exitCode = STOP_EXIT_CODE;
    return true;
  }

  return false;
}

/**
 * Adds elapsed time to an execution log and writes it as one JSON line.
 */
export function logExecution(
  executionLog: Record<string, unknown>,
  startTime: Date,
): void {
  const log = executionLog;
  log["ElapsedSeconds"] = Math.round((Date.now() - startTime.getTime()) / 1000);
  writeJsonLine(log);
}

/**
 * Writes a record as one JSON line to stdout with bigint and cycle-safe conversion.
 */
export function writeJsonLine(record: unknown): void {
  process.stdout.write(
    `${JSON.stringify(toJsonLogValue(record, new WeakSet()), jsonLogReplacer)}\n`,
  );
}

/**
 * Converts bigint values to strings for JSON log serialization.
 */
export function jsonLogReplacer(_: string, value: JsonLogValue | bigint): JsonLogValue {
  return typeof value === "bigint" ? value.toString() : value;
}

function errorToLog(error: unknown): JsonLogValue {
  return toJsonLogValue(error, new WeakSet());
}

/**
 * Converts an unknown value into a JSON-line-safe log value.
 *
 * @remarks
 * Bigints become decimal strings, valid dates become ISO strings, invalid dates
 * become `null`, cycles become `[Circular]`, and functions become
 * `[Unsupported log value]`. Error-like objects keep public metadata such as
 * `name`, `message`, `stack`, `cause`, `txHash`, `status`, and `isTimeout`.
 * This normalizer makes values serializable; it does not sanitize arbitrary
 * secrets that callers pass in.
 */
export function toJsonLogValue(value: unknown, seen: WeakSet<object>): JsonLogValue {
  let logValue: JsonLogValue;
  if (typeof value === "string") {
    logValue = value;
  } else if (typeof value === "bigint") {
    logValue = value.toString();
  } else if (typeof value === "function") {
    logValue = UNSAFE_LOG_VALUE;
  } else if (isJsonLogPrimitive(value)) {
    logValue = value ?? "Empty Error";
  } else if (value instanceof Date) {
    logValue = dateLogValue(value);
  } else if (isErrorLike(value)) {
    logValue = errorLikeToLogValue(value, seen, toJsonLogValue);
  } else {
    logValue = objectLogValue(value, seen, toJsonLogValue);
  }

  return logValue;
}

function isJsonLogPrimitive(value: unknown): value is JsonLogPrimitive {
  return typeof value !== "object" || value === null;
}

function dateLogValue(value: Date): string | null {
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function isErrorLike(value: unknown): value is object & { stack?: unknown } {
  return value instanceof Object && "stack" in value;
}

function errorLikeToLogValue(
  error: object & { stack?: unknown },
  seen: WeakSet<object>,
  convert: (value: unknown, seen: WeakSet<object>) => JsonLogValue,
): JsonLogValue {
  let logValue: JsonLogValue = CIRCULAR_LOG_VALUE;
  if (!seen.has(error)) {
    seen.add(error);
    try {
      const logged: JsonLogRecord = {
        ...errorOwnProperties(error, seen, convert),
        name: logPropertyIfPresent(error, "name", seen, convert),
        message: errorLogMessage(error),
        txHash: logPropertyIfPresent(error, "txHash", seen, convert),
        status: logPropertyIfPresent(error, "status", seen, convert),
        isTimeout: logPropertyIfPresent(error, "isTimeout", seen, convert),
        stack: typeof error.stack === "string" ? error.stack : "",
      };
      if ("cause" in error) {
        logged["cause"] = convert(Reflect.get(error, "cause"), seen);
      }
      logValue = logged;
    } finally {
      seen.delete(error);
    }
  }

  return logValue;
}

function objectLogValue(
  value: object,
  seen: WeakSet<object>,
  convert: (value: unknown, seen: WeakSet<object>) => JsonLogValue,
): JsonLogValue {
  let logValue: JsonLogValue = CIRCULAR_LOG_VALUE;
  if (!seen.has(value)) {
    seen.add(value);
    try {
      logValue = Array.isArray(value)
        ? value.map((entry): JsonLogValue => convert(entry, seen))
        : objectEntriesLogValue(value, seen, convert);
    } finally {
      seen.delete(value);
    }
  }

  return logValue;
}

function logPropertyIfPresent(
  value: object,
  key: string,
  seen: WeakSet<object>,
  convert: (value: unknown, seen: WeakSet<object>) => JsonLogValue,
): JsonLogValue {
  if (!(key in value)) {
    return undefined;
  }
  return convert(Reflect.get(value, key), seen);
}

function errorLogMessage(error: object): string {
  const message = MESSAGE_KEY in error ? Reflect.get(error, MESSAGE_KEY) : undefined;
  return typeof message === "string" ? message : UNKNOWN_ERROR_MESSAGE;
}

function errorOwnProperties(
  error: object,
  seen: WeakSet<object>,
  convert: (value: unknown, seen: WeakSet<object>) => JsonLogValue,
): JsonLogRecord {
  const properties: JsonLogRecord = {};
  for (const [key, entry] of Object.entries(error)) {
    if (ERROR_BUILTIN_KEYS.has(key)) {
      continue;
    }
    properties[key] = convert(entry, seen);
  }
  return properties;
}

function objectEntriesLogValue(
  value: object,
  seen: WeakSet<object>,
  convert: (value: unknown, seen: WeakSet<object>) => JsonLogValue,
): JsonLogRecord {
  const jsonValue: JsonLogRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    jsonValue[key] = convert(entry, seen);
  }
  return jsonValue;
}

function shouldStopAfterError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "TransactionConfirmationError" &&
    "isTimeout" in error &&
    error.isTimeout === true
  );
}
