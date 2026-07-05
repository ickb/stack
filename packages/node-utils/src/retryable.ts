const MESSAGE_KEY = "message";

/** Normalized message used for retryable fetch transport failures. */
export const FETCH_FAILED_MESSAGE = "fetch failed";

/**
 * Returns true for transient fetch transport failures surfaced by the RPC client.
 */
export function isRetryableRpcTransportError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === FETCH_FAILED_MESSAGE) {
    return true;
  }
  if (!(error instanceof Error) || error.message !== FETCH_FAILED_MESSAGE) {
    return false;
  }
  const cause = "cause" in error ? error.cause : undefined;
  return isFetchFailedTypeErrorCause(cause);
}

/**
 * Returns true for malformed or mismatched RPC responses that can be retried.
 */
export function isRetryableRpcResponseShapeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/^Id mismatched, got .+, expected \d+$/u.test(error.message) ||
      (error.name === "SyntaxError" &&
        /^Unexpected token '<', .+ is not valid JSON$/u.test(error.message)))
  );
}

/**
 * Returns true for CKB pool/indexer state races that may succeed after retry.
 */
export function isRetryableCkbStateRaceError(error: unknown): boolean {
  const parsed = rpcErrorCodeAndData(error);
  return parsed !== undefined && isRetryableStateRaceData(parsed.code, parsed.data);
}

function isFetchFailedTypeErrorCause(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "TypeError" &&
    MESSAGE_KEY in cause &&
    cause.message === FETCH_FAILED_MESSAGE
  );
}

interface RpcErrorCodeAndData {
  code: number;
  data: string;
}

function rpcErrorCodeAndData(error: unknown): RpcErrorCodeAndData | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = "code" in error ? error.code : undefined;
  const data = "data" in error ? error.data : undefined;
  if (typeof code !== "number" || typeof data !== "string") {
    return undefined;
  }
  return { code, data };
}

const RETRYABLE_STATE_RACE_MARKERS = new Map<number, readonly string[]>([
  [-1111, ["RBFRejected("]],
  [-301, ["Resolve(Unknown(OutPoint(", "Resolve(Dead(OutPoint("]],
  [-1107, ["Duplicated(Byte32("]],
]);

function isRetryableStateRaceData(code: number, data: string): boolean {
  return (
    RETRYABLE_STATE_RACE_MARKERS.get(code)?.some((marker) => data.includes(marker)) ??
    false
  );
}
