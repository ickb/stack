# Findings to Investigate

> Status: Open and non-authoritative. This file contains only current-code gaps and questions that remain after the decision record. Historical proposals that have been superseded are not implementation instructions.

## Evidence boundary

The authority review used Stack branch `wip` at commit `d38532248c8ed1e573bebea272ac6324cbfd9a61` and the working-tree decision documents frozen at these SHA-256 values:

- decision record: `1af75c84e2dc8be467af4d29f1dd0d5ca4f652203b27d87a32b9624e3e5c0eef`
- CCC integration companion: `7f5b8bae7299d56f2d466f3b8d84459fa7cac0ec1e6109d4cd2f004283dbc9a0`

That review was read-only. Later maintainer decisions superseded its signed-store, replay, pending-overlay, global-fence, and rollback-store proposals. The review remains evidence for defects in those rejected designs, not authority to rebuild them.

## Additional follow-ups

- Verify the golden-vector generator commit against the deployed ELF fixture authority. Current documentation cites contracts commit `ae8a11f` and deployed `ickb_logic` commit `454cfa96` for different evidence roles.
- Add durable provenance enforcement for generated protocol vectors rather than relying on prose alone.
- Resolve npm version and registry handling before publication.
- Define a completion-aware owner before selecting fee-safe CKB Max; `ckbAvailable` alone does not reserve output capacity or fees.
- Decide whether order migration ever accepts the deployed resolver's confusion-attack residual; keep orders action-required until then.
- Small CKB-to-iCKB requests are stuck (user, 2026-09-14). The iCKB-to-CKB path escalates the order fee for a small amount until it covers the matcher's ten-mining-fee threshold (`estimateDustIckbToCkbOrder` in `sdk/src/conversion/sdk_estimate.ts`), so a small sell is still placeable at a worse price; the CKB-to-iCKB path only tries the default 0.001% fee and reports `amount-too-small` below about `10 × feeRate × 100000` shannons (10 CKB at a 1000 fee rate, 332 CKB at testnet's 33222). Evaluate: (a) the same fee escalation for CKB-to-iCKB remainder orders, so any amount is placeable and the user sees the price before signing; (b) failing that, the SDK's `amount-too-small` failure carrying the minimum it computed, so the interface can say "enter at least N CKB" instead of "enter a larger amount".

## Investigation order

1. Bind generated-vector provenance to executable fixture evidence.
