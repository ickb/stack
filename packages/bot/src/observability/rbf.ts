export function isRbfRejectedReason(reason: string): boolean {
  try {
    return parsedReasonIsRbfRejected(JSON.parse(reason));
  } catch {
    return false;
  }
}

function parsedReasonIsRbfRejected(value: unknown): boolean {
  return isRecord(value) && value["type"] === "RBFRejected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
