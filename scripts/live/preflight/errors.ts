interface RetryableNodeUtils {
  isRetryableRpcTransportError?: (error: unknown) => boolean;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const errorType = typeof error;
  switch (errorType) {
    case "bigint":
    case "boolean":
    case "number":
    case "string":
    case "symbol": {
      return String(error);
    }
    case "function":
    case "object":
    case "undefined": {
      return "Unknown error";
    }
    default: {
      errorType satisfies never;
      return "Unknown error";
    }
  }
}

export function isPublicChainIdentityError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    ((error.message.includes("Missing") && error.message.includes("genesis header")) ||
      (error.message.includes("Invalid") && error.message.includes("chain identity")))
  );
}

export function isRetryablePreflightError(
  error: unknown,
  nodeUtils: RetryableNodeUtils,
): boolean {
  return nodeUtils.isRetryableRpcTransportError?.(error) === true;
}
