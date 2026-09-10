import type { RootConfig } from "../shared/utils.ts";

const cccConnectionInfoKey = "ccc-connection-info";
const selectedChainKey = "ickb-selected-chain";

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Detects whether saved CCC connection metadata has wallet and signer names.
 */
export function hasSavedCccConnection(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): boolean {
  try {
    const value = storage?.getItem(cccConnectionInfoKey);
    if (value === undefined || value === null || value === "") {
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
    return false;
  }
}

function isConnectionRecord(
  value: unknown,
): value is { signerName?: unknown; walletName?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the persisted chain selector, ignoring malformed storage values.
 */
export function savedSelectedChain(
  storage: Pick<Storage, "getItem"> | undefined = browserStorage(),
): RootConfig["chain"] | undefined {
  try {
    const value = storage?.getItem(selectedChainKey);
    return value === "mainnet" || value === "testnet" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persists the selected chain when browser storage is available.
 */
export function saveSelectedChain(
  chain: RootConfig["chain"],
  storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(selectedChainKey, chain);
  } catch {
    // Ignore storage failures; network selection still works for this session.
  }
}
