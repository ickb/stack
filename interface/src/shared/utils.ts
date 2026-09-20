import { ccc } from "@ckb-ccc/ccc";
import type { ConversionMetadata, ConversionNotice, IckbSdk } from "@ickb/sdk";
import type { QueryClient } from "@tanstack/react-query";

/** Chain-level resources shared before a wallet signer is selected. */
export interface RootConfig {
  /** Public CKB chain selected by the interface. */
  chain: "mainnet" | "testnet";

  /** CCC client used for reads and transaction submission. */
  cccClient: ccc.Client;

  /**
   * Gives the client a new, empty cache after any transaction error. CCC's cache clear keeps
   * block headers, and a deep reorg is possible on CKB, where one pool holds a majority of
   * the hash power; the client keeps its identity, so nothing remounts and the pending
   * hash, the failure message and the frozen preview survive (decisions amendment 52(k)).
   */
  resetClient: () => void;

  /** Shared React Query client. */
  queryClient: QueryClient;

  /** iCKB SDK configured for the selected chain. */
  sdk: IckbSdk;
}

/** Wallet-bound resources required to preview and submit conversion transactions. */
export interface WalletConfig extends RootConfig {
  /** Connected CCC signer. */
  signer: ccc.Signer;

  /** Recommended address displayed as the wallet identity. */
  address: string;

  /** Unique account locks scanned as wallet-owned state. */
  accountLocks: ccc.Script[];

  /** Primary lock used for new conversion requests. */
  primaryLock: ccc.Script;
}

/**
 * Describes a transaction preview or a non-throwing preview error.
 *
 * @remarks A non-empty error means callers must treat the transaction as non-broadcastable even though padding fields are still present.
 */
export type TxInfo = Readonly<{
  tx: ccc.Transaction;
  error: string;
  fee: bigint;
  estimatedMaturity: bigint;
  conversionKind?: ConversionMetadata["kind"];
  /**
   * Set when the transaction moves the liquid funds to another lock: the shortened
   * destination, and whether the sweep took every liquid cell or another move is needed.
   */
  move?: { to: string; isComplete: boolean };
  conversionNotice?: ConversionNotice;
  /** The epoch the transaction must be sent before, when it requests withdrawals. */
  broadcastBefore?: ccc.Epoch;
}>;

export const txInfoPadding: TxInfo = Object.freeze({
  tx: ccc.Transaction.default(),
  error: "",
  fee: 0n,
  estimatedMaturity: 0n,
});

/** The small line under a value the user cannot edit, saying why, centred beneath it. */
export const reasonLabelClass =
  "absolute top-full left-1/2 -translate-x-1/2 -translate-y-1.5 text-xs leading-none font-medium tracking-normal whitespace-nowrap text-ickb-muted normal-case";

/** The main button's look, shared by every button that reads as an action. */
export const buttonClass =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded border-2 border-ickb-action px-4 text-center leading-relaxed font-bold tracking-wider text-ickb-action uppercase transition-colors duration-150 hover:bg-ickb-action/10 active:bg-ickb-action/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action disabled:cursor-default disabled:opacity-50";

/**
 * Maps CCC address prefixes to the interface chain name.
 */
export function chainFromClient(client: ccc.Client): RootConfig["chain"] | undefined {
  switch (client.addressPrefix) {
    case "ckb":
      return "mainnet";
    case "ckt":
      return "testnet";
    default:
      return undefined;
  }
}

export function walletLabel(
  walletName: string | undefined,
  signerName: string | undefined,
): string {
  const name = [walletName, signerName].filter(Boolean).join(" ");
  if (name !== "") {
    return name;
  }

  return "Wallet";
}

export const CKB = ccc.fixedPointFrom(1);
export const maxShannons = (1n << 64n) - 1n;

export type AmountInput =
  | Readonly<{ status: "valid"; amount: bigint; error: "" }>
  | Readonly<{ status: "intermediate"; amount: undefined; error: "" }>
  | Readonly<{ status: "invalid"; amount: undefined; error: string }>;

/** Parses the exact fixed-point grammar accepted for CKB and iCKB amounts. */
export function parseAmountInput(text: string): AmountInput {
  if (text === "") {
    return { status: "valid", amount: 0n, error: "" };
  }
  if (text === ".") {
    return { status: "intermediate", amount: undefined, error: "" };
  }
  // ASCII digits only: `\d` never matches other scripts' digits, with or without `u`.
  // eslint-disable-next-line security/detect-unsafe-regex -- The optional group starts with a literal dot, so no input backtracks.
  const parts = /^(\d*)(?:\.(\d{0,8}))?$/u.exec(text);
  if (parts === null) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Enter a decimal amount with up to 8 decimal places",
    };
  }

  const [, whole = "", fraction = ""] = parts;
  const amount = BigInt(`0${whole}`) * CKB + BigInt(fraction.padEnd(8, "0"));
  if (amount > maxShannons) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Amount exceeds the supported maximum",
    };
  }

  return { status: "valid", amount, error: "" };
}

export function toText(amount: bigint): string {
  const text = ccc.fixedPointToString(amount);
  return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0*$/u, "");
}

/** Two decimals, rounded half up: the estimate's precision on screen. */
export function twoDecimals(shannons: bigint): string {
  const cents = (shannons + CKB / 200n) / (CKB / 100n);
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}

export function clampShannons(amount: bigint): bigint {
  return amount > maxShannons ? maxShannons : amount;
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    // Wallet providers reject with plain objects such as {code: 4001, message: "..."}.
    if ("message" in error && typeof error.message === "string" && error.message !== "") {
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }

  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return String(error);
  }

  return "Unknown error";
}
