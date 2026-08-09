export function errorOf(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const message = errorMessage(error);
  return new Error(message, { cause: error });
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
    return JSON.stringify(error, stringifyBigInt);
  } catch {
    return String(error);
  }
}

type JsonReplacerInput = string | number | boolean | bigint | null | object | undefined;

function stringifyBigInt(
  _key: string,
  value: JsonReplacerInput,
): Exclude<JsonReplacerInput, bigint> | string {
  return typeof value === "bigint" ? value.toString() : value;
}
