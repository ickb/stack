export function errorOf(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const message = errorMessage(error);
  return new Error(message, { cause: errorCause(error) });
}

function errorCause(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    return "name" in error && typeof error.name === "string" && error.name.length > 0
      ? error.name
      : "Object";
  }

  return error === null ? "null" : typeof error;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error, stringifyErrorValue);
  } catch {
    return String(error);
  }
}

function stringifyErrorValue(
  this: Record<string, unknown> | unknown[],
  key: string,
  value: unknown,
): unknown {
  const original = Array.isArray(this) ? this[Number(key)] : this[key];
  if (original instanceof Date) {
    return Number.isNaN(original.getTime()) ? null : original.toISOString();
  }

  return typeof value === "bigint" ? value.toString() : value;
}
