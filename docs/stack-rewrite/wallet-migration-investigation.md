# Wallet Migration Investigation

> Status: Evidence and constraints for the later Phase-5 slice selected by amendment 31. No migration API is implemented.

## Problem

A user may need to retire an old wallet without converting native iCKB to CKB and entering iCKB again. The source still has to connect and sign; a destination cannot recover missing source keys or bypass an unsupported source signer.

The product origin is maintainer-held user correspondence outside this repository: a July 2026 request to move a Ledger-backed wallet with minimal transactions, and an August 2026 report that the observed position was native xUDT. Intermediate protocol state was raised as a migration case, not observed in that account.

The destination identity is always a same-chain CKB lock. An EVM-facing wallet such as MetaMask may control that lock through CCC, but an EVM `0x` address is not the destination CKB identity.

## Evidence

Stack evidence refers to the same commit that contains this document. Protocol evidence uses [`ickb/contracts` commit `ae8a11fa560c157116e3f75acc316682d9cca061`](https://github.com/ickb/contracts/tree/ae8a11fa560c157116e3f75acc316682d9cca061) and [`ickb/whitepaper` commit `9984d53b9530c1418df587d3c28058bdb9363e98`](https://github.com/ickb/whitepaper/tree/9984d53b9530c1418df587d3c28058bdb9363e98). The installed wallet boundary is `@ckb-ccc/core` 1.19.1, `@ckb-ccc/ccc` 1.3.0, and `@ckb-ccc/connector-react` 1.1.9. The core package resolves at `node_modules/.pnpm/@ckb-ccc+core@1.19.1_typescript@6.0.3_zod@3.25.76/node_modules/@ckb-ccc/core` with lockfile integrity `sha512-yaxtUqN+NF1sbSlSWHn5P8K47CUpFIw0AAakl84ureoTTaS5hozCNt3WGRhfhRMuIwrhNXkcFhO2c/2jTKefSg==`.

Source-only receipt completion already ships. The amount-zero collection flow consumes eligible receipts and returns canonical native iCKB to the source lock (`packages/sdk/src/client/sdk_conversion_class.ts:72-95`; `packages/sdk/src/conversion/sdk_conversion_common.ts:22-45`; `packages/sdk/src/client/sdk_base.ts:117-151`). A wallet's own UI does not need to understand receipts when CCC can provide the source signer to the iCKB interface.

## State Constraints

| Source-owned state  | Safe path                                                                                                                 | First slice |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Plain CKB           | Spend source cells into destination CKB. This needs destination-owned ordinary change and explicit residual-fee handling. | Deferred    |
| Native iCKB xUDT    | Spend source iCKB and create one destination-locked canonical iCKB output.                                                | Included    |
| Receipt             | Consume the non-transferable receipt and complete it into destination-locked native iCKB.                                 | Included    |
| Matchable order     | Preserve and report it. Automatic melt can select a forged qualifying descendant and strand the genuine order.            | Excluded    |
| Completed order     | Preserve and report it while the deployed lineage-confusion residual remains unresolved.                                  | Excluded    |
| Ready withdrawal    | Claim into ordinary CKB. This belongs with the later CKB movement increment.                                              | Deferred    |
| Immature withdrawal | Keep the old wallet until maturity; ownership cannot rotate while preserving the live DAO withdrawal request.             | Blocker     |

Receipts are user-locked phase-1 results; their associated DAO deposits are protocol-locked pool cells. Deposit phase 2 consumes the receipt and mints native iCKB. The deployed logic does not bind the minted xUDT output lock (`scripts/tests/src/tests/ickb_logic/phase2_recipient_binding.rs:3-42`). Orders remain separate because the deployed resolver cannot prove genuine lineage (`scripts/tests/src/tests/limit_order/fake_match_lineage.rs:61-121`). Immature withdrawals cannot rotate ownership (`scripts/tests/src/tests/owned_owner/live_claim_rotation.rs:3-75`).

## Selected Slice

1. Connect the destination and retain its exact same-chain CKB lock, displayed address, wallet name, and network in session state.
2. Reconnect the source. It remains the only transaction signer and fee payer.
3. Move all native iCKB and complete all eligible receipts by default. Create exactly one destination-locked canonical iCKB xUDT output for their combined value; every other output remains source-owned.
4. Include no pasted destination, per-cell selection, order, withdrawal, generic xUDT, second signer, persistent coordination, or automatic batching.
5. When one transaction exceeds a protocol, wallet, capacity, or size limit, fail before signing. The existing collect flow can complete receipts in place before a later native-iCKB-only move.

The destination connection derives identity and reduces valid-but-wrong-address risk; it does not prove future connector support, device access, or permanent iCKB operability. Converting or withdrawing iCKB to CKB later still requires an iCKB-capable web-connected wallet and DApp. A Neuron-like wallet can custody and transfer native iCKB but is deliberately outside this connected-destination slice.

## Required Behavior

- Destination network or identity changes invalidate the preview.
- The destination owns exactly one canonical iCKB xUDT output; every other output is source-owned.
- Orders and immature withdrawals remain visible as source-side residual state. The interface never claims that the old key is safe to retire.

## Deferred

- Plain CKB and ready-withdrawal movement. This increment owns destination CKB change, sub-minimum remainder behavior, and warnings when source-side state still needs fee capacity.
- Order migration while the deployed lineage-confusion residual remains unresolved.
- Pasted custody destinations, deterministic batching, generic xUDTs, multiple source signers, and persistent coordination.
