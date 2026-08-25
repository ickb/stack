# Findings to Investigate

> Status: Open and non-authoritative. This file contains only current-code gaps and questions that remain after the decision record. Historical proposals that have been superseded are not implementation instructions.

## Evidence boundary

The authority review used Stack branch `wip` at commit `d38532248c8ed1e573bebea272ac6324cbfd9a61` and the working-tree decision documents frozen at these SHA-256 values:

- decision record: `1af75c84e2dc8be467af4d29f1dd0d5ca4f652203b27d87a32b9624e3e5c0eef`
- CCC integration companion: `7f5b8bae7299d56f2d466f3b8d84459fa7cac0ec1e6109d4cd2f004283dbc9a0`

That review was read-only. Later maintainer decisions superseded its signed-store, replay, pending-overlay, global-fence, and rollback-store proposals. The review remains evidence for defects in those rejected designs, not authority to rebuild them.

## Questions with competing evidence

### Ring intervention

The accepted one-window kernel uses hard selection filters. Later review argued that attacker-steerable deposits can delay the bot's own liquidity operations. A preference with bounded deferral may be safer, but it changes a confirmed product decision and needs explicit ratification.

## Additional follow-ups

- Verify the golden-vector generator commit against the deployed ELF fixture authority. Current documentation cites contracts commit `ae8a11f` and deployed `ickb_logic` commit `454cfa96` for different evidence roles.
- Decide whether raw `IckbDeploymentConfig` or manager construction has external users before removing it from the public constructor surface.
- Add durable provenance enforcement for generated protocol vectors rather than relying on prose alone.
- Decide whether manifest history needs mechanical enforcement; the current amendment rule is review-governed.
- Resolve npm version and registry handling before publication.

## Investigation order

1. Ratify or reject the ring preference change.
2. Resolve the public raw-config/manager constructor surface from concrete consumer evidence.
3. Bind generated-vector provenance to executable fixture evidence.
