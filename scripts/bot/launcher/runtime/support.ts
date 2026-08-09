export function publicErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown launcher error";
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function ignoreError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Best-effort cleanup must preserve the original launcher error.
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
