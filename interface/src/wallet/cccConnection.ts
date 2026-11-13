const cccConnectionInfoKey = "ccc-connection-info";

/** Detects whether saved CCC connection metadata has wallet and signer names. */
export function hasSavedCccConnection(): boolean {
  try {
    // A missing or empty record fails the parse like a malformed one.
    const connection: unknown = JSON.parse(
      // Stryker disable next-line StringLiteral: any fallback text either fails the parse or parses to no record with both names, so it only satisfies the type checker.
      globalThis.localStorage.getItem(cccConnectionInfoKey) ?? "",
    );
    return (
      isConnectionRecord(connection) &&
      typeof connection.walletName === "string" &&
      connection.walletName.length > 0 &&
      typeof connection.signerName === "string" &&
      connection.signerName.length > 0
    );
  } catch {
    // Storage may be absent or denied; a malformed record reads as no saved connection.
    return false;
  }
}

function isConnectionRecord(
  value: unknown,
): value is { signerName?: unknown; walletName?: unknown } {
  // An array passes, but has neither name.
  // Stryker disable next-line ConditionalExpression,LogicalOperator: a primitive has neither name and null throws into the caller's catch, so weakening the guard changes no result; this also skips replacing it with false, which the tests kill.
  return typeof value === "object" && value !== null;
}
