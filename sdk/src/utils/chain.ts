import type { ccc } from "@ckb-ccc/core";

/** Public CKB networks supported by Stack consumers. */
export type SupportedChain = "mainnet" | "testnet";

/** Canonical public identity of one supported CKB network. */
export interface ChainIdentity {
  /** Stack network selector represented by this identity. */
  readonly chain: SupportedChain;
  /** CKB specification network name. */
  readonly networkName: string;
  /** Canonical genesis block hash. */
  readonly genesisHash: ccc.Hex;
  /** Canonical genesis message used by the CKB specification. */
  readonly genesisMessage: string;
  /** Public specification location from which the genesis identity was derived. */
  readonly genesisSource: string;
  /** Canonical address prefix for this network. */
  readonly addressPrefix: "ckb" | "ckt";
}

const chainIdentities = Object.freeze({
  mainnet: Object.freeze({
    chain: "mainnet",
    networkName: "ckb",
    genesisHash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
    genesisMessage:
      "lina 0x18e020f6b1237a3d06b75121f25a7efa0550e4b3f44f974822f471902424c104",
    genesisSource:
      "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/mainnet.toml",
    addressPrefix: "ckb",
  }),
  testnet: Object.freeze({
    chain: "testnet",
    networkName: "ckb_testnet",
    genesisHash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
    genesisMessage: "aggron-v4",
    genesisSource:
      "https://raw.githubusercontent.com/nervosnetwork/ckb/develop/resource/specs/testnet.toml",
    addressPrefix: "ckt",
  }),
} as const satisfies Record<SupportedChain, ChainIdentity>);

/** Returns the immutable canonical identity for one supported chain. */
export function expectedChainIdentity(chain: SupportedChain): ChainIdentity {
  return chainIdentities[chain];
}
