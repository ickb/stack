import process from "node:process";

const CIRCULAR_LOG_VALUE = "[Circular]";

/** JSON-line-safe value after log normalization. */
export type JsonLogValue =
  string | number | boolean | null | undefined | JsonLogValue[] | JsonLogRecord;

export interface JsonLogRecord {
  [key: string]: JsonLogValue;
}

/** Writes one turn as one JSON line, `type` and `timestamp` first like the bot's events. */
export function logExecution(type: string, executionLog: object, startTime: Date): void {
  writeJsonLine({
    type,
    timestamp: startTime.toISOString(),
    ...executionLog,
    elapsedMs: Date.now() - startTime.getTime(),
  });
}

/** Writes a record as one JSON line to stdout. */
export function writeJsonLine(record: object): void {
  process.stdout.write(`${JSON.stringify(toJsonLogRecord(record))}\n`);
}

/**
 * Normalizes a record for JSON logging: bigints become decimal strings, dates ISO strings,
 * cycles `[Circular]`, and error-like objects keep their enumerable fields plus `name`,
 * `message`, `stack`, and `cause`, which `JSON.stringify` alone would drop. Everything else
 * is what `JSON.stringify` does natively. Nothing here sanitizes secrets a caller passes in.
 */
export function toJsonLogRecord(record: object): JsonLogRecord {
  return entriesLogValue(record, new WeakSet());
}

// eslint-disable-next-line sonarjs/function-return-type -- A JSON value is a union by definition.
function toJsonLogValue(value: unknown, ancestors: WeakSet<object>): JsonLogValue {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") {
    // Functions, symbols, and undefined: dropped, as `JSON.stringify` drops them.
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (ancestors.has(value)) {
    return CIRCULAR_LOG_VALUE;
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? value.map((entry): JsonLogValue => toJsonLogValue(entry, ancestors))
      : entriesLogValue(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function entriesLogValue(value: object, ancestors: WeakSet<object>): JsonLogRecord {
  const logged: JsonLogRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    logged[key] = toJsonLogValue(entry, ancestors);
  }
  if ("stack" in value) {
    // An error's identifying fields are non-enumerable, so `Object.entries` misses them.
    for (const key of ["name", "message", "stack", "cause"]) {
      if (key in value) {
        logged[key] = toJsonLogValue(Reflect.get(value, key), ancestors);
      }
    }
  }
  return logged;
}
