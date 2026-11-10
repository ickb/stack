import { ccc } from "@ckb-ccc/core";

/** Nervos DAO type script. */
export const DAO = ccc.Script.from({
  codeHash: "0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
  hashType: "type",
  args: "0x",
});

/** iCKB Logic script. */
export const ICKB_LOGIC = ccc.Script.from({
  codeHash: "0x2a8100ab5990fa055ab1b50891702e1e895c7bd1df6322cd725c1a6115873bd3",
  hashType: "data1",
  args: "0x",
});

/** Owned Owner lock script. */
export const OWNED_OWNER = ccc.Script.from({
  codeHash: "0xacc79e07d107831feef4c70c9e683dac5644d5993b9cb106dca6e74baa381bd0",
  hashType: "data1",
  args: "0x",
});

/** Order lock script. */
export const ORDER = ccc.Script.from({
  codeHash: "0x49dfb6afee5cc8ac4225aeea8cb8928b150caf3cd92fea33750683c74b13254a",
  hashType: "data1",
  args: "0x",
});

/**
 * The iCKB xUDT type script: xUDT in owner mode, its args iCKB Logic's script hash then the
 * owner-mode flag 0x80000000 as four little-endian bytes.
 */
export const ICKB_UDT = ccc.Script.from({
  codeHash: "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
  hashType: "data1",
  args: ccc.hexFrom(ccc.bytesConcat(ICKB_LOGIC.hash(), ccc.numLeToBytes(0x80000000n, 4))),
});

/** Public CKB networks supported by Stack consumers: the ones iCKB is deployed on. */
export type SupportedChain = "mainnet" | "testnet";

/**
 * Each network's genesis block hash, as CKB's mainnet.toml and testnet.toml specs give it,
 * and its iCKB dep group: the group carries every iCKB script's code cell, xUDT's and iCKB
 * Logic's included, so one group dep resolves them all.
 */
export const CHAINS = {
  mainnet: {
    genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
    depGroup: {
      txHash: "0x621a6f38de3b9f453016780edac3b26bfcbfa3e2ecb47c2da275471a5d3ed165",
      index: 0,
    },
  },
  testnet: {
    genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
    depGroup: {
      txHash: "0xf7ece4fb33d8378344cab11fcd6a4c6f382fd4207ac921cf5821f30712dcd311",
      index: 0,
    },
  },
} as const satisfies Record<
  SupportedChain,
  { genesisHash: ccc.Hex; depGroup: ccc.OutPointLike }
>;

/** The iCKB dep group of the chain whose genesis block has `genesisHash`. */
export function ickbDepGroup(genesisHash: ccc.Hex): ccc.CellDep {
  const chain = Object.values(CHAINS).find((known) => known.genesisHash === genesisHash);
  if (chain === undefined) {
    throw new Error("unsupported network");
  }
  return ccc.CellDep.from({ outPoint: chain.depGroup, depType: "depGroup" });
}
