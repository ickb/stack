import { logValue } from "./logValue.ts";

const ERROR_CAUSE_KEY = "cause";
const ERROR_EXTRA_KEYS = ["txHash", "status", "isTimeout"] as const;
const ERROR_BUILTIN_KEYS = new Set(["name", "message", "stack", ERROR_CAUSE_KEY]);

/**
 * Converts arbitrary thrown values into JSON-safe failure evidence.
 *
 * @remarks This function records values it is given; callers must keep signing
 * material and other secrets out of error objects before they reach logging.
 */
export function errorSummary(
  error: unknown,
  options: { includeStack?: boolean } = {},
): Record<string, unknown> | string {
  return summarizeError(error, new Set<unknown>(), options.includeStack !== false);
}

function summarizeError(
  error: unknown,
  seen: Set<unknown>,
  includeStack: boolean,
): Record<string, unknown> | string {
  return error instanceof Error
    ? summarizeNativeError(error, seen, includeStack, summarizeError)
    : summarizeThrownValue(error, seen);
}

function summarizeNativeError(
  error: Error,
  seen: Set<unknown>,
  includeStack: boolean,
  summarize: (
    error: unknown,
    seen: Set<unknown>,
    includeStack: boolean,
  ) => Record<string, unknown> | string,
): Record<string, unknown> {
  const circular = trackNativeError(error, seen);
  if (circular !== undefined) {
    return circular;
  }
  return {
    ...nativeErrorFields(error, seen),
    ...(includeStack && error.stack !== undefined
      ? { stack: logValue(error.stack, seen) }
      : {}),
    ...(ERROR_CAUSE_KEY in error
      ? { cause: summarizeNativeCause(error.cause, seen, includeStack, summarize) }
      : {}),
  };
}

function summarizeNativeCause(
  cause: unknown,
  seen: Set<unknown>,
  includeStack: boolean,
  summarize: (
    error: unknown,
    seen: Set<unknown>,
    includeStack: boolean,
  ) => Record<string, unknown> | string,
): Record<string, unknown> | string {
  return summarize(cause, seen, includeStack);
}

function summarizeThrownValue(
  error: unknown,
  seen: Set<unknown>,
): Record<string, unknown> | string {
  let summary: Record<string, unknown> | string;
  if (typeof error === "object" && error !== null) {
    summary = {
      message: "Non-Error object",
      details: logValue(error, seen),
    };
  } else if (typeof error === "string") {
    summary = error;
  } else if (isStringifiedThrownValue(error)) {
    summary = error.toString();
  } else {
    summary = "Empty Error";
  }
  return summary;
}

function trackNativeError(
  error: Error,
  seen: Set<unknown>,
): Record<string, unknown> | undefined {
  if (seen.has(error)) {
    return { message: "Circular error reference" };
  }
  seen.add(error);
  return undefined;
}

function nativeErrorFields(error: Error, seen: Set<unknown>): Record<string, unknown> {
  return {
    ...errorOwnProperties(error, seen),
    name: error.name,
    message: logValue(error.message, seen),
    ...errorExtraFields(error, seen),
  };
}

function errorOwnProperties(error: Error, seen: Set<unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (!ERROR_BUILTIN_KEYS.has(key)) {
      properties[key] = value;
    }
  }
  // CCC/CKB RPC errors carry retry evidence such as code, data, outPoint,
  // currentFee, and leastFee as enumerable Error fields.
  return logRecord(properties, seen);
}

function errorExtraFields(error: Error, seen: Set<unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const values = error as Record<string, unknown>;
  for (const key of ERROR_EXTRA_KEYS) {
    if (key in error) {
      fields[key] = logValue(values[key], seen);
    }
  }
  return fields;
}

function logRecord(
  value: Record<string, unknown>,
  seen: Set<unknown>,
): Record<string, unknown> {
  const logged: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    logged[key] = logValue(entry, seen);
  }
  return logged;
}

function isStringifiedThrownValue(error: unknown): error is number | boolean | bigint {
  return (
    typeof error === "number" || typeof error === "boolean" || typeof error === "bigint"
  );
}
