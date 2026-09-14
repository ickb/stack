import { ccc } from "@ckb-ccc/ccc";
import type { ConversionMetadata, IckbSdk } from "@ickb/sdk";
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
  conversionNotice?: {
    kind: "dust-ickb-to-ckb" | "maturity-unavailable";
    inputIckb: bigint;
    outputCkb: bigint;
    incentiveCkb: bigint;
    maturityEstimateUnavailable: boolean;
  };
}>;

export const txInfoPadding: TxInfo = Object.freeze({
  tx: ccc.Transaction.default(),
  error: "",
  fee: 0n,
  estimatedMaturity: 0n,
});

export const CKB = ccc.fixedPointFrom(1);
export const maxShannons = (1n << 64n) - 1n;

export function symbol2Direction(symbol: string): boolean {
  return symbol !== "I";
}

export function direction2Symbol(isCkb2Udt: boolean): string {
  return isCkb2Udt ? "C" : "I";
}

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
  const parts = fixedPointParts(text);
  if (parts === undefined) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Enter a decimal amount with up to 8 decimal places",
    };
  }

  const [whole, fractionalPart] = parts;
  const fraction = `${fractionalPart}00000000`.slice(0, 8);
  const amount = BigInt(whole) * CKB + BigInt(fraction);
  if (amount > maxShannons) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Amount exceeds the supported maximum",
    };
  }

  return { status: "valid", amount, error: "" };
}

function fixedPointParts(text: string): readonly [string, string] | undefined {
  const dotIndex = text.indexOf(".");
  if (dotIndex === -1) {
    return isAsciiDigits(text) ? [text, ""] : undefined;
  }
  if (dotIndex !== text.lastIndexOf(".")) {
    return undefined;
  }

  const whole = text.slice(0, dotIndex);
  const fraction = text.slice(dotIndex + 1);
  return validFixedPointParts(whole, fraction)
    ? [whole === "" ? "0" : whole, fraction]
    : undefined;
}

function validFixedPointParts(whole: string, fraction: string): boolean {
  if (fraction.length > 8) {
    return false;
  }
  if (whole === "") {
    return fraction !== "" && isAsciiDigits(fraction);
  }
  return isAsciiDigits(whole) && (fraction === "" || isAsciiDigits(fraction));
}

function isAsciiDigits(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index);
    if (code === undefined || code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

export function toText(amount: bigint): string {
  const text = ccc.fixedPointToString(amount);
  return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0*$/u, "");
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

export function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
}
