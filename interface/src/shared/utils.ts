import { ccc } from "@ckb-ccc/ccc";
import type { ickb } from "@ickb/sdk";
import type { QueryClient } from "@tanstack/react-query";

/** The network the connector's client is on, as the app labels it. */
export type Chain = "mainnet" | "testnet";

/** Chain-level resources shared before a wallet signer is selected. */
export interface RootConfig {
  /** The network of the connector's client. */
  chain: Chain;

  /** CCC client used for reads and transaction submission. */
  cccClient: ccc.Client;

  /** Shared React Query client. */
  queryClient: QueryClient;
}

/** Wallet-bound resources required to preview and submit conversion transactions. */
export interface WalletConfig extends RootConfig {
  /** Connected CCC signer. */
  signer: ccc.Signer;

  /** Recommended address displayed as the wallet identity. */
  address: string;
}

/** A completed, funded transaction, the SDK's build result as it is: only signing remains. */
export type SendableTx = Readonly<
  Extract<ickb.ConversionTransactionResult, { ok: true }>
>;

/**
 * A transaction preview, or why there is none. A failure has no date of its own: what is
 * already converting is dated by the state it was built from.
 */
export type TxInfo = SendableTx | Readonly<{ ok: false; error: string }>;

/** The main button's look, shared by every button that reads as an action. */
export const buttonClass =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded border-2 border-ickb-action px-4 text-center leading-relaxed font-bold tracking-wider text-ickb-action uppercase transition-colors duration-150 hover:bg-ickb-action/10 active:bg-ickb-action/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action disabled:cursor-default disabled:opacity-50";

/**
 * The app's label for the client's network: mainnet by its `ckb` address prefix, testnet
 * otherwise. A devnet reads as testnet; the SDK refuses a chain it has no deployment on.
 */
export function chainFromClient(client: ccc.Client): Chain {
  return client.addressPrefix === "ckb" ? "mainnet" : "testnet";
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

export const CKB = ccc.One;
export const maxShannons = (1n << 64n) - 1n;

export type AmountInput =
  | Readonly<{ status: "valid"; amount: bigint; error: "" }>
  | Readonly<{ status: "intermediate"; amount: undefined; error: "" }>
  | Readonly<{ status: "invalid"; amount: undefined; error: string }>;

/** Parses the exact fixed-point grammar accepted for CKB and iCKB amounts. */
export function parseAmountInput(text: string): AmountInput {
  // An empty field passes the grammar below as zero.
  if (text === ".") {
    return { status: "intermediate", amount: undefined, error: "" };
  }
  // ASCII digits only: `\d` never matches other scripts' digits, with or without `u`.
  // eslint-disable-next-line security/detect-unsafe-regex -- The optional group starts with a literal dot, so no input backtracks.
  if (!/^\d*(?:\.\d{0,8})?$/u.test(text)) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Enter a decimal amount with up to 8 decimal places",
    };
  }

  // CCC would drop a ninth decimal and take a sign; the grammar above refuses both first.
  const amount = ccc.fixedPointFrom(text);
  if (amount > maxShannons) {
    return {
      status: "invalid",
      amount: undefined,
      error: "Amount exceeds the supported maximum",
    };
  }

  return { status: "valid", amount, error: "" };
}

export function clampShannons(amount: bigint): bigint {
  return ccc.numMin(amount, maxShannons);
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    // An empty message would fall to JSON.stringify, which shows "{}" for an Error.
    return error.message === "" ? "Unknown error" : error.message;
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
      // A cyclic or bigint-holding object: unknown, below.
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
