# Findings to Investigate

> Status: Open and non-authoritative. This file contains only current-code gaps and questions that remain after the decision record. Historical proposals that have been superseded are not implementation instructions.

## Evidence boundary

The authority review used Stack branch `wip` at commit `d38532248c8ed1e573bebea272ac6324cbfd9a61` and the working-tree decision documents frozen at these SHA-256 values:

- decision record: `1af75c84e2dc8be467af4d29f1dd0d5ca4f652203b27d87a32b9624e3e5c0eef`
- CCC integration companion: `7f5b8bae7299d56f2d466f3b8d84459fa7cac0ec1e6109d4cd2f004283dbc9a0`

That review was read-only. Later maintainer decisions superseded its signed-store, replay, pending-overlay, global-fence, and rollback-store proposals. The review remains evidence for defects in those rejected designs, not authority to rebuild them.

The follow-ups once listed here are closed: vector provenance enforcement and test depth were struck as polish without an observed failure (amendment 52(ae)), npm handling is settled (52(ad)), fee-safe CKB Max was deleted (52(z)), and existing orders stay where they are under the destination field (52(af)); this file keeps only the evidence pins above.
