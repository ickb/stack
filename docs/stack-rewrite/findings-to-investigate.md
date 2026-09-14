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
- The `amount-too-small` failure should carry the minimum (user, 2026-09-14). A CKB-to-iCKB remainder order below about `10 × feeRate × 100000` shannons (10 CKB at a 1000 fee rate, 332 CKB at testnet's 33222) is refused because its 0.001% fee would not cover the matcher's ten mining fees; the SDK computes that threshold, so the failure can carry the minimum and the interface can say "Enter at least 340 CKB" (rounded up to two significant figures, unit by direction) instead of "Enter a larger amount" (wording user-ratified 2026-09-14). No fee escalation for this direction (user decision 2026-09-14); the iCKB-to-CKB dust path stays as it is.

## Investigation order

1. Bind generated-vector provenance to executable fixture evidence.
