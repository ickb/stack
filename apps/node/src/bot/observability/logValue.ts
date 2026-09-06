const UNSUPPORTED_LOG_VALUE = "[Unsupported log value]";

type ImmediateLogValue =
  { handled: true; value: LogValue } | { handled: false; value: object };
export type LogValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export function logValue(value: unknown, seen: Set<unknown>): LogValue {
  const immediate = immediateLogValue(value);
  let logged: LogValue;
  if (immediate.handled) {
    logged = immediate.value;
  } else if (immediate.value instanceof Date) {
    logged = Number.isNaN(immediate.value.getTime())
      ? null
      : immediate.value.toISOString();
  } else if (seen.has(immediate.value)) {
    logged = "[Circular]";
  } else {
    seen.add(immediate.value);
    try {
      logged = Array.isArray(immediate.value)
        ? immediate.value.map((entry) => logValue(entry, seen))
        : Object.fromEntries(
            Object.entries(immediate.value).map(([key, entry]) => [
              key,
              logValue(entry, seen),
            ]),
          );
    } finally {
      seen.delete(immediate.value);
    }
  }
  return logged;
}

function immediateLogValue(value: unknown): ImmediateLogValue {
  if (typeof value === "bigint") {
    return { handled: true, value: value.toString() };
  }
  if (typeof value === "function") {
    return { handled: true, value: UNSUPPORTED_LOG_VALUE };
  }
  if (isImmediateLogPrimitive(value)) {
    return { handled: true, value };
  }
  return { handled: false, value };
}

function isImmediateLogPrimitive(
  value: unknown,
): value is string | number | boolean | symbol | null | undefined {
  return typeof value !== "object" || value === null;
}
