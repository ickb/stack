import { ccc } from "@ckb-ccc/ccc";
import { useEffect, useState } from "react";
import { errorMessageOf, type WalletConfig } from "../shared/utils.ts";

/**
 * The lock that owns every cell the next transaction creates for the user.
 *
 * @remarks `moveTo` names the destination when it is not one of the wallet's own locks:
 * completion then sweeps everything liquid to it, so the transaction is also a move
 * (decisions amendment 52(af)).
 */
export interface Destination {
  readonly lock: ccc.Script;
  readonly moveTo?: string;
}

/** The address field as the header shows it: the text, its setter, and what it resolved to. */
export interface DestinationField {
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly isValid: boolean;
  readonly isForeign: boolean;
}

type DestinationRead = Readonly<
  { text: string } & ({ destination: Destination } | { error: string })
>;

/**
 * Parses a pasted address on the wallet's chain into the destination of the next
 * transaction; empty text means the wallet's own address, like an empty amount means zero.
 */
export function useDestination(
  text: string,
  walletConfig: WalletConfig,
): { destination?: Destination; error: string } {
  const [read, setRead] = useState<DestinationRead>();
  const isEmpty = text === "";
  useEffect(() => {
    const cancelled = new AbortController();
    if (!isEmpty) {
      void (async (): Promise<void> => {
        let next: DestinationRead;
        try {
          next = { text, destination: await parseDestination(text, walletConfig) };
        } catch (error: unknown) {
          next = { text, error: errorMessageOf(error) };
        }
        if (!cancelled.signal.aborted) {
          setRead(next);
        }
      })();
    }
    return (): void => {
      cancelled.abort();
    };
  }, [text, walletConfig, isEmpty]);

  if (isEmpty) {
    return { destination: { lock: walletConfig.primaryLock }, error: "" };
  }
  if (read?.text !== text) {
    return { error: "" };
  }
  return "error" in read
    ? { error: read.error }
    : { destination: read.destination, error: "" };
}

/** Resolves a full CKB address on the wallet's chain, or throws the message to show. */
export async function parseDestination(
  text: string,
  walletConfig: WalletConfig,
): Promise<Destination> {
  let address: ccc.Address;
  try {
    address = await ccc.Address.fromString(text.trim(), walletConfig.cccClient);
  } catch {
    throw new Error(
      `Enter a valid ${walletConfig.chain === "mainnet" ? "Mainnet" : "Testnet"} address`,
    );
  }
  const lock = ccc.Script.from(address.script);
  return walletConfig.accountLocks.some((own) => own.eq(lock))
    ? { lock }
    : { lock, moveTo: shortAddress(address.toString()) };
}

/** Both ends of an address with the middle elided; a short one stays intact. */
export function shortAddress(address: string): string {
  if (address.length <= 21) {
    return address;
  }
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}
