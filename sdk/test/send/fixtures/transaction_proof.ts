import type { cccA } from "@ckb-ccc/core/advanced";
import type { TransactionProof } from "../../../src/send/sign_and_send_transaction.ts";

/**
 * Mainnet block 20871474 (0x13e7932), seven transactions, with
 * `get_transaction_proof` answers for its second and last transactions, as
 * https://mainnet.ckb.dev/ returned them on 2026-10-29.
 */
export const PROOF_BLOCK: cccA.JsonRpcBlockHeader = {
  compact_target: "0x1915759d",
  dao: "0x88b0073606da755bcc030a00dedf2a00df0a66f841168d0a0099dd5d65993407",
  epoch: "0x61a0237003b60",
  extra_hash: "0xa0e27ff9836d258b34a615818b84ff545b69662815f053bbdaa77b3901d4ad0a",
  hash: "0x2c02852263b3fd0f1371a34b5e8f70866344efbc0485ca39dc508465711805ce",
  nonce: "0xdc2c808ced9acceb00000002a5650301",
  number: "0x13e7932",
  parent_hash: "0xfe4603e94af73fd4988df9a092204364ed18e62151b4c81dbe4001364637b7dd",
  proposals_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  timestamp: "0x1a1893fefd9",
  transactions_root: "0x1eabdd140a3758769170ae8563f6dacb8fc1c07cd94d4ed0a66082f390c4a85a",
  version: "0x0",
};

export const PROOF_TXS = {
  second: {
    txHash: "0x177967d8cabe254368d15412920eb071aa579b02671f51aae766df02120baa47",
    proof: {
      block_hash: "0x2c02852263b3fd0f1371a34b5e8f70866344efbc0485ca39dc508465711805ce",
      proof: {
        indices: ["0x7"],
        lemmas: [
          "0x8e76eca3b9b358d81e3fccf7c6dabfb65db24b8f7b643d395a70f6146e1947fd",
          "0x241edc5253bb38c695d5d75439f0d9159d5208764353d1638e3d42fd1a9dcbc8",
          "0xd964a834f460478f331635f686a5f7e5fdc260dd50d856b5a175f27c4b7185d8",
        ],
      },
      witnesses_root:
        "0x4279d8fc556dfe34b3db5280b9e5b33f5ced866de09d0fb86f16e9c1049c0f62",
    },
  },
  last: {
    txHash: "0xf6c1d94857839502dd44a1b2871ca66ae4846633d1f85049c7f23ae42d9b64ee",
    proof: {
      block_hash: "0x2c02852263b3fd0f1371a34b5e8f70866344efbc0485ca39dc508465711805ce",
      proof: {
        indices: ["0xc"],
        lemmas: [
          "0x5a8516cc8cd9aa779bc27ef8044386f68d7340d33321227730f0c9aaf5046ce7",
          "0x4e164ab61c0aa4dbb55f357dd7808b47fd888f58fefe9f3ccc4751ca0b1c6a5b",
          "0xe8bbcc660a452d17e1a3f9b0963383a85e4e1525cdda201c612f9c364497cfa3",
        ],
      },
      witnesses_root:
        "0x4279d8fc556dfe34b3db5280b9e5b33f5ced866de09d0fb86f16e9c1049c0f62",
    },
  },
} as const satisfies Record<
  string,
  // The node answers the block hash too, which the check does not need.
  { txHash: `0x${string}`; proof: TransactionProof & { block_hash: `0x${string}` } }
>;
