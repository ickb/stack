import type { RootConfig } from "../shared/utils.ts";

const cccConnectionInfoKey = "ccc-connection-info";
const selectedChainKey = "ickb-selected-chain";

/** Detects whether saved CCC connection metadata has wallet and signer names. */
export function hasSavedCccConnection(): boolean {
  try {
    const value = globalThis.localStorage.getItem(cccConnectionInfoKey);
    if (value === null || value === "") {
      return false;
    }

    const connection: unknown = JSON.parse(value);
    if (!isConnectionRecord(connection)) {
      return false;
    }
    return (
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the persisted chain selector, ignoring malformed storage values. */
export function savedSelectedChain(): RootConfig["chain"] | undefined {
  try {
    const value = globalThis.localStorage.getItem(selectedChainKey);
    return value === "mainnet" || value === "testnet" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the selected chain when browser storage is available. */
export function saveSelectedChain(chain: RootConfig["chain"]): void {
  try {
    globalThis.localStorage.setItem(selectedChainKey, chain);
  } catch {
    // Ignore storage failures; network selection still works for this session.
  }
}
