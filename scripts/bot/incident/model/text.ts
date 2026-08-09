export function stripLineEnding(line: string): string {
  const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
  return withoutNewline.endsWith("\r") ? withoutNewline.slice(0, -1) : withoutNewline;
}

export function scanAsciiDigits(line: string, start: number, limit: number): number {
  let end = start;
  while (end < line.length && end < start + limit && isAsciiDigit(line[end])) {
    end += 1;
  }
  return end;
}

export function isAsciiDigits(value: string): boolean {
  if (value === "") {
    return false;
  }
  for (const character of value) {
    if (!isAsciiDigit(character)) {
      return false;
    }
  }
  return true;
}

export function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function publicErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown incident collector error";
}

export async function ignoreError(promise: Promise<unknown> | undefined): Promise<void> {
  try {
    await promise;
  } catch {
    // Best-effort cleanup must preserve the original collector error.
  }
}
