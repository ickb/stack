# Authority and Enforcement Review

> Status: Review findings against a frozen working-tree version of the decision record. This document is evidence, not authority. Amendment 20 closes F-001 through F-003 by deleting the signed-transaction authority they reviewed. F-004's direct Node-loader example is closed by the narrowed exact-file review guard; deliberate evasion is outside that lint contract and would require runtime/build isolation.

## Findings

### F-001. high - Replacement election can remove pending-spend protection

`docs/reviews/2026-08-10T00-12-04Z-final-decisions.md:118` elects an active transaction from all eligible same-input transactions, including transactions that are temporarily non-replayable. The same clause allows only active replayable transactions to contribute pending overlays.

Trigger: pending, replayable transaction A and a higher-priority replacement B share an input, but B is currently non-replayable. B suppresses A during election and contributes no overlay itself. The planner can then treat A's input as available even though A can still commit. This violates the pending-spend invariant recorded at `docs/reviews/2026-08-10T00-12-04Z-final-decisions-appendix-ccc-audit.md:84,103`.

Direction: elect among replayable contenders or conservatively reserve the conflict set until the winning transaction becomes replayable or terminal.

### F-002. medium - Dep-group members cannot be derived from signed transaction bytes

`docs/reviews/2026-08-10T00-12-04Z-final-decisions.md:118` says that direct and resolved dep-group cell dependencies derive from the signed bytes. A serialized CKB `CellDep` contains the dep-group cell out-point and `depType`; its member out-points live in the dep-group cell's on-chain data.

The required-outpoint replay check therefore cannot obtain resolved members from the durable row alone. An implementation following the clause literally must either omit member liveness checks or create a second, unspecified resolver, despite amendment section 16 assigning dependency resolution to the canonical SDK resolver.

Direction: derive cell-dep references from the signed bytes and obtain dep-group members through the canonical chain resolver defined by section 16.

### F-003. medium - Definitively inert transactions have no garbage-collection path

`docs/reviews/2026-08-10T00-12-04Z-final-decisions.md:118` permits row removal only after the transaction's commitment or a competing input consumption reaches horizon `K`. A definitively script-invalid or fee/RBF-invalid transaction cannot commit. When its inputs are never consumed by a replacement, neither removal condition can occur.

The row then remains indefinitely. Because the inert classification is not persisted, each fresh session also performs another bounded re-probe. Repeated rejected transactions can grow the bot state store or exhaust the interface's localStorage collection.

Direction: add bounded removal for reconfirmed definitively inert rows once no retained descendant depends on them.

### F-004. medium - Oracle-independence enforcement permits programmatic implementation loading

The exact-file ESLint override at `eslint.config.mts:142-167,547-565` rejects static imports and re-exports, ECMAScript dynamic imports, and TypeScript import types. The negative controls at `scripts/test/tooling/eslint/contract-oracle-independence.ts:11-27` cover those forms. They do not reject Node's programmatic module loader.

The following source produces no ESLint diagnostics when linted as `packages/testkit/src/contract_oracle.ts` while loading implementation code:

```ts
const require = process.getBuiltinModule("node:module").createRequire(import.meta.url);
const implementation: unknown = require("../../core/src/index.ts");
export { implementation };
```

This defeats the lint-enforced independence boundary recorded at `docs/reviews/2026-08-10T00-12-04Z-final-decisions.md:11,79`. The path is unlikely to arise accidentally, and one independent reviewer classified it as residual risk rather than a material defect. The gate nevertheless permits the behavior it exists to prohibit.

Direction: reject programmatic module loading in the exact-file rule and add a negative control for the supported Node loader path.

## Verdict

Four material issues remain in the reviewed authority and enforcement changes. The first three are specification defects in the durable signed-transaction authority. The fourth is an enforcement gap in the contract-oracle independence gate. No material issue was found in the root-export manifest ownership change, the dependency-cruiser treeshake exception, the appendix mapping-time reframing, the root-export README rewrite, or the oracle's inline-disable removal.

## Scope

- Checkout: `/var/home/user/Projects/ickb/stack`
- Branch and HEAD: `wip` at `d38532248c8ed1e573bebea272ac6324cbfd9a61`
- Index: empty
- Reviewed state: seven unstaged tracked files and one untracked test file; this report and any later artifacts are not part of that frozen state
- Role boundary: read-only review; no source, test, configuration, documentation, or Git state was changed during the review

The reviewed working-tree evidence was frozen by Git blob ID:

| File                                                                      | Blob                                       |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| `.dependency-cruiser.jsonc`                                               | `f43c52a72b67c57fb8c01195a7e38928e7d1ce5e` |
| `docs/reviews/2026-08-10T00-12-04Z-final-decisions-appendix-ccc-audit.md` | `1eb3a02a911ecba2aebe1a31132471cc0db68172` |
| `docs/reviews/2026-08-10T00-12-04Z-final-decisions.md`                    | `afe7b63b94e0b54fe9381cb612e872b36f3fa918` |
| `eslint.config.mts`                                                       | `d15c064654a127a67730234a201430b54c08a34b` |
| `packages/testkit/src/contract_oracle.ts`                                 | `05d8d08614efe5b4b393bdfeeda3d97bb2fa672b` |
| `scripts/tooling/probes/root-export-floor/README.md`                      | `20636ddfbea8dba975cb56c6fb03279c4ad14658` |
| `scripts/tooling/probes/root-export-floor/manifest.json`                  | `3f4b440ac0e9bcd564e38ff8064ec318b4403186` |
| `scripts/test/tooling/eslint/contract-oracle-independence.ts`             | `49b05f8210575f26940122c7ff184ba0bdc46bf6` |

The blob identities remained unchanged through the original review and its independent cross-challenge.

## Validation

The following focused checks passed against the frozen state:

- root TypeScript typecheck
- ESLint over the changed enforcement files and contract oracle
- four contract-oracle independence tests: three negative-control tests and the real-oracle positive control
- dependency-cruiser over `apps`, `packages`, and `scripts`
- root-export-floor probe: 0 failures, 4 known missing, 39 entries
- Prettier over all changed files

Additional independent checks reported clean results for knip and source-structure lint. The dependency-cruiser change was confirmed to repair a real orphan diagnostic for `scripts/tooling/probes/treeshake/run.ts`.

## Independent Review

The frozen evidence was reviewed independently by OpenAI GPT-5.6 Sol, Anthropic Opus 5, and xAI Grok 4.5, followed by a cross-challenge over all candidate findings.

- All reviewers accepted F-001 and F-002 as material.
- OpenAI and Anthropic accepted F-003 as material; xAI classified its impact as residual store growth rather than a correctness failure.
- OpenAI and xAI accepted F-004 as material. Anthropic confirmed the lint-clean loader path but classified it as residual risk because the documented syntax-specific claim remains literally true and the bypass is unlikely to occur accidentally.
- Proposed findings about stale `hash as index` wording, the CCC floor, and residual entity names in prose did not survive adjudication as material issues.

## Residual Risks

- Recovery/garbage-collection horizon `K` remains an explicit open decision.
- The root-export manifest's add/update-only history rule is review-governed. Deleting an entry would not fail the current probe without comparison to repository history.
- Triple-slash `/// <reference types="..." />` is accepted by the oracle's exact-file ESLint configuration. Its effect is limited to ambient declarations, but it is another syntax-level blind spot in a policy described more broadly as oracle independence.
