import type { ParsedEvidence } from "./supervisorTypes.ts";

const OUTPUT_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/u;

/**
 * Parses preflight output, accepting either one JSON object or JSONL evidence.
 */
export function parsePreflightEvidence(stdout: string): ParsedEvidence {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return { records: [], ignoredLines: [], malformedLines: [] };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed)
      ? { records: [parsed], ignoredLines: [], malformedLines: [] }
      : { records: [], ignoredLines: [], malformedLines: [trimmed] };
  } catch {
    return parseJsonEvidence(stdout);
  }
}

/**
 * Parses JSONL command output into accepted, ignored, and malformed evidence lines.
 */
export function parseJsonEvidence(stdout: string): ParsedEvidence {
  const records = new Array<Record<string, unknown>>();
  const ignoredLines = new Array<string>();
  const malformedLines = new Array<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (!trimmed.startsWith("{")) {
      ignoredLines.push(trimmed);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      // Lines reaching this parser branch start with "{", so valid JSON is an object.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- JSON.parse cannot express this preceding lexical guard to TypeScript.
      records.push(parsed as Record<string, unknown>);
    } catch {
      malformedLines.push(trimmed);
    }
  }
  return { records, ignoredLines, malformedLines };
}

export function optionalRecordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return record === undefined ? undefined : recordField(record, key);
}

export function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

export function optionalStringField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, string> {
  const value = stringField(record, key);
  return value === undefined ? {} : { [key]: value };
}

export function bigintStringField(
  record: Record<string, unknown> | undefined,
  key: string,
): bigint | undefined {
  const value = stringField(record, key);
  return value !== undefined && /^-?(?:0|[1-9]\d*)$/u.test(value)
    ? BigInt(value)
    : undefined;
}

export function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isOutputIndex(value: unknown): value is string {
  return (
    typeof value === "string" &&
    OUTPUT_INDEX_PATTERN.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

export function booleanField(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function boundedText(text: string, limit: number): string {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= limit) {
    return text;
  }
  if (limit <= 0) {
    return "";
  }
  let marker = truncationMarker(byteLength);
  if (Buffer.byteLength(marker, "utf8") > limit) {
    return "";
  }
  let includedBytes = 0;
  let end = 0;
  for (const codePoint of text) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    const nextIncludedBytes = includedBytes + codePointBytes;
    const nextMarker = truncationMarker(byteLength - nextIncludedBytes);
    if (nextIncludedBytes + Buffer.byteLength(nextMarker, "utf8") > limit) {
      break;
    }
    includedBytes = nextIncludedBytes;
    end += codePoint.length;
    marker = nextMarker;
  }
  return `${text.slice(0, end)}${marker}`;
}

function truncationMarker(omittedBytes: number): string {
  return `\n<truncated ${String(omittedBytes)} bytes>`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

export function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

export function isAlreadyExistsError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "EEXIST";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type JsonReplacerInput =
  string | number | boolean | bigint | null | Record<string, unknown> | unknown[];

export function jsonReplacer(
  _key: string,
  value: JsonReplacerInput,
): Exclude<JsonReplacerInput, bigint> | string {
  return typeof value === "bigint" ? value.toString() : value;
}
