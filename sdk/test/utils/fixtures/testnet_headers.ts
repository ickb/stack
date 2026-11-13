import type { cccA } from "@ckb-ccc/core/advanced";
import { GENESIS_HEADERS } from "@ickb/testkit";

/**
 * Two testnet headers as the public node answered `get_header_by_number`, hash included:
 * the testkit's genesis and block 22,875,720, read on 2026-10-27. They pin the header encoder to the chain.
 */
export const TESTNET_HEADERS: readonly [
  cccA.JsonRpcBlockHeader,
  cccA.JsonRpcBlockHeader,
] = [
  GENESIS_HEADERS.testnet,
  {
    compact_target: "0x1d084f85",
    dao: "0xc0f0d6a410e603593eb371f8686c2a00c250bf236663870a00db9bd6d0eb8209",
    epoch: "0x70806f70036ff",
    extra_hash: "0x2bf79ba01bd7f2c9249d5b9543e3051c59c04a4a3973a5149b7d4ed5f241b09f",
    hash: "0x69e7abd8436af4f84d0bc4c6bfd3da031f8e4c0995416263cf76d08dc9d30579",
    nonce: "0x373df74ee8be859d3a89ea27bb2e606a",
    number: "0x15d0e48",
    parent_hash: "0x85554e69413498e788e6f557dd3df6a9f29d079fa59512fc5b60f77b52336961",
    proposals_hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: "0x1a17b71ef41",
    transactions_root:
      "0x212f14867b72549a49c32e2ede36038beeb7e86fad1bb66aa54d7a3d258759fc",
    version: "0x0",
  },
];
