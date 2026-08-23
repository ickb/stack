# Findings to Investigate

> Status: Open and non-authoritative. This file contains only current-code gaps and questions that remain after the decision record. Historical proposals that have been superseded are not implementation instructions.

## Evidence boundary

The authority review used Stack branch `wip` at commit `d38532248c8ed1e573bebea272ac6324cbfd9a61` and the working-tree decision documents frozen at these SHA-256 values:

- decision record: `1af75c84e2dc8be467af4d29f1dd0d5ca4f652203b27d87a32b9624e3e5c0eef`
- CCC integration companion: `7f5b8bae7299d56f2d466f3b8d84459fa7cac0ec1e6109d4cd2f004283dbc9a0`

That review was read-only. Later maintainer decisions superseded its signed-store, replay, pending-overlay, global-fence, and rollback-store proposals. The review remains evidence for defects in those rejected designs, not authority to rebuild them.

## Confirmed implementation gaps

### Current signer lock discovery is not complete

CCC `getAddressObjs()` may return only the connector's discovered address set. Treat that result as ordinary caller-selected account scope rather than proof of a complete lock universe; the SDK does not restrict CCC signer families or claim cross-attempt serialization from this list.

### Current completion still has two collectors

`IckbUdt.completeBy` and CCC `completeFeeBy` still select cache-first inputs independently of the exact account scans. The rewrite must feed Stack-selected committed cells into completion, retain existing receipt/deposit native-iCKB valuation through uncached committed reads, disable both collectors, and assert that completion preserves the complete ordered input/output shape allowed by decision amendment 26.

### Current fee fallback violates settled output ownership

`packages/sdk/src/client/sdk_base.ts` can route ordinary fee change into a receipt, order master, owned-owner marker, or plain output. Decision amendment 26 permits only zero change or one signer-owned plain CKB change output while preserving constructor reserves exactly, so this routing and its retry helpers must be deleted.

### Current rejection recovery clears CCC cache

`packages/sdk/src/send/wait_transaction.ts` still clears the whole client cache and exposes `rebuildReady`. Both are deleted in the target design. Later actions use exact committed reads and do not reconcile or repair cache state.

### Current interface persists a hash-only record

`apps/interface/src/query/pendingTransactionQuery.ts` persists `{version: 1, txHash}`. The target interface keeps only current-session observation state, so this record and its migration/freeze logic should be deleted rather than upgraded.

## Questions with competing evidence

### Public entity base symbols

The committed B4 probe requires `EntityBase` and each named `XBase` under the selected API Extractor configuration. An alternative declaration recipe should be considered only with an exact packed declaration/API/tree-shaking probe, not from preference.

### Ring intervention

The accepted one-window kernel uses hard selection filters. Later review argued that attacker-steerable deposits can delay the bot's own liquidity operations. A preference with bounded deferral may be safer, but it changes a confirmed product decision and needs explicit ratification.

## Additional follow-ups

- Verify the golden-vector generator commit against the deployed ELF fixture authority. Current documentation cites contracts commit `ae8a11f` and deployed `ickb_logic` commit `454cfa96` for different evidence roles.
- Decide whether raw `IckbDeploymentConfig` or manager construction has external users before removing it from the public constructor surface.
- Add durable provenance enforcement for generated protocol vectors rather than relying on prose alone.
- Decide whether manifest history needs mechanical enforcement; the current add/update-only rule is review-governed.
- Resolve npm version and registry handling before publication.
- Complete ICKB-014 wording for a current-session bounded wait, without pending-chain or replay language.

## Investigation order

1. Record the source for each hard limit implemented by the Phase-2 SDK compactor.
2. Run the B4 declaration alternative only if a smaller exact recipe emerges.
3. Ratify or reject the ring preference change.
