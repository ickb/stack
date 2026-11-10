import type { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";

/**
 * Each chain's genesis header as its public node answered `get_header_by_number` with
 * `0x0` on 2026-11-10: https://mainnet.ckb.dev/rpc and https://testnet.ckb.dev/rpc. The
 * hashes, mainnet 0x92b197aa…50d0e5 and testnet 0x10639e08…3f9606, are the ones CKB's
 * mainnet.toml and testnet.toml specs give, so the SDK's hash check passes on them.
 */
export const GENESIS_HEADERS = {
  mainnet: {
    compact_target: "0x1a08a97e",
    dao: "0x8874337e541ea12e0000c16ff286230029bfa3320800000000710b00c0fefe06",
    epoch: "0x0",
    extra_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    hash: "0x92b197aa1fba0f63633922c61c92375c9c074a93e85963554f5499fe1450d0e5",
    nonce: "0x0",
    number: "0x0",
    parent_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    proposals_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: "0x16e70e6985c",
    transactions_root:
      "0x31bf3fdf4bc16d6ea195dbae808e2b9a8eca6941d589f6959b1d070d51ac28f7",
    version: "0x0",
  },
  testnet: {
    compact_target: "0x1e015555",
    dao: "0x0469b82c6c1ea12e0000c16ff286230066cbed490e00000000b2b49f02fbfe06",
    epoch: "0x0",
    extra_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    hash: "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606",
    nonce: "0x0",
    number: "0x0",
    parent_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    proposals_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: "0x172083ec170",
    transactions_root:
      "0x00e5d0a4869bc21533d7487ee2377b514245bdfca3ac30ba0710e608011760f6",
    version: "0x0",
  },
} as const satisfies Record<"mainnet" | "testnet", cccA.JsonRpcBlockHeader>;

/** The chain's real genesis header, as CCC decodes the node's answer. */
export function genesisHeader(
  chain: keyof typeof GENESIS_HEADERS,
): ccc.ClientBlockHeader {
  return cccA.JsonRpcTransformers.blockHeaderTo(GENESIS_HEADERS[chain]);
}
