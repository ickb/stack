import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  capacityCell,
  headerLike,
  script,
  StubClient,
} from "@ickb/testkit";

export const TESTNET_GENESIS_HASH =
  "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
export const MAINNET_GENESIS_HASH =
  "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5";
export const FETCH_FAILED_MESSAGE = "fetch failed";
export const TRANSACTION_FAILED_TO_RESOLVE_MESSAGE =
  "Client request error TransactionFailedToResolve";
export const TRANSACTION_CONFIRMATION_TIMEOUT_MESSAGE =
  "Transaction confirmation timed out";

export function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

export function transactionError(
  isTimeout: boolean,
  txHash = byte32FromByte("11"),
): Error {
  return Object.assign(
    new TransactionConfirmationError(TRANSACTION_CONFIRMATION_TIMEOUT_MESSAGE),
    {
      txHash,
      status: isTimeout ? "sent" : "rejected",
      isTimeout,
    },
  );
}

export class RpcPreflightError extends Error {
  public override name = "RpcPreflightError";
}

export function preflightClient({
  addressPrefix,
  genesisHash,
  tipHash,
  tipNumber,
  tipTimestamp,
}: {
  addressPrefix: string;
  genesisHash: `0x${string}`;
  tipHash: `0x${string}`;
  tipNumber: bigint;
  tipTimestamp: bigint;
}): ccc.Client {
  return new StubClient({
    addressPrefix,
    getHeaderByNumber: async (
      blockNumber,
    ): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      if (blockNumber !== 0n) {
        return undefined;
      }
      return headerLike({ hash: genesisHash, number: 0n });
    },
    getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return headerLike({
        hash: tipHash,
        number: tipNumber,
        timestamp: tipTimestamp,
      });
    },
  });
}

export class AddressStubSigner extends ccc.SignerCkbPrivateKey {
  private readonly addresses: ccc.Address[];

  constructor(addresses: ccc.Address[]) {
    super(new StubClient(), `0x${"11".repeat(32)}`);
    this.addresses = addresses;
  }

  public override async getAddressObjs(): Promise<ccc.Address[]> {
    await Promise.resolve();
    return this.addresses;
  }
}

class TransactionConfirmationError extends Error {
  public override name = "TransactionConfirmationError";
}

export { byte32FromByte, capacityCell, script };
