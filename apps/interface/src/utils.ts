import { ccc } from "@ckb-ccc/ccc";
import type { QueryClient } from "@tanstack/react-query";
import type { IckbUdt, LogicManager, OwnedOwnerManager } from "@ickb/core";
import type { OrderManager } from "@ickb/order";
import type { IckbSdk } from "@ickb/sdk";

export interface RootConfig {
  chain: "mainnet" | "testnet";
  cccClient: ccc.Client;
  queryClient: QueryClient;
  sdk: IckbSdk;
  managers: {
    ickbUdt: IckbUdt;
    logic: LogicManager;
    ownedOwner: OwnedOwnerManager;
    order: OrderManager;
  };
}

export interface WalletConfig extends RootConfig {
  signer: ccc.Signer;
  address: string;
  accountLocks: ccc.Script[];
  primaryLock: ccc.Script;
}

export type TxInfo = Readonly<{
  tx: ccc.Transaction;
  error: string;
  fee: bigint;
  estimatedMaturity: bigint;
}>;

export const txInfoPadding: TxInfo = Object.freeze({
  tx: ccc.Transaction.default(),
  error: "",
  fee: 0n,
  estimatedMaturity: 0n,
});

export const CKB = ccc.fixedPointFrom(1);

// reservedCKB are reserved for state rent in conversions
export const reservedCKB = 600n * CKB;

export function symbol2Direction(symbol: string): boolean {
  return symbol !== "I";
}

export function direction2Symbol(isCkb2Udt: boolean): string {
  return isCkb2Udt ? "C" : "I";
}

export function sanitizeAmountInput(text: string): string {
  let sanitized = "";
  let seenDot = false;
  let fractionalDigits = 0;

  for (const char of text) {
    if (char >= "0" && char <= "9") {
      if (!seenDot) {
        sanitized += char;
      } else if (fractionalDigits < 8) {
        sanitized += char;
        fractionalDigits += 1;
      }
      continue;
    }

    if (char === "." && !seenDot) {
      sanitized = sanitized === "" ? "0." : `${sanitized}.`;
      seenDot = true;
    }
  }

  return sanitized;
}

export function toText(amount: bigint): string {
  const text = ccc.fixedPointToString(amount);
  return text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0*$/u, "");
}

export function toBigInt(text: string): bigint {
  if (text === "") {
    return 0n;
  }

  const [wholePart, fractionalPart = ""] = text.split(".", 2);
  const whole = wholePart === "" ? "0" : wholePart;
  const fraction = (fractionalPart + "00000000").slice(0, 8);
  return BigInt(whole) * CKB + BigInt(fraction);
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
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

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  return "Unknown error";
}

export function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
}
