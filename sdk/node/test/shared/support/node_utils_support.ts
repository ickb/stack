import type { ccc } from "@ckb-ccc/core";
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

/** A client that answers only the genesis header read, with `genesisHash`. */
export function preflightClient(genesisHash: `0x${string}`): ccc.Client {
  return new StubClient({
    getHeaderByNumber: async (
      blockNumber,
    ): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return blockNumber === 0n
        ? headerLike({ hash: genesisHash, number: 0n })
        : undefined;
    },
  });
}

export { byte32FromByte, capacityCell, script };
