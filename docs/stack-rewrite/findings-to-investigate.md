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
- Decide whether manifest history needs mechanical enforcement; the current amendment rule is review-governed.
- Resolve npm version and registry handling before publication.
- Define a completion-aware owner before selecting fee-safe CKB Max; `ckbAvailable` alone does not reserve output capacity or fees.
- Decide whether order migration ever accepts the deployed resolver's confusion-attack residual; keep orders action-required until then.

## Investigation order

1. Ratify or reject the ring preference change.
2. Bind generated-vector provenance to executable fixture evidence.
