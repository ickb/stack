# Appendix — CKB Integration Audit mapped onto the rewrite decisions

Companion to `2026-08-10T00-12-04Z-final-decisions.md` §5. Sources: audit repo `/var/home/user/Projects/ckb-integration-audit/` (CCC pin `ckb-devrel/ccc@8a19abcd`; iCKB evidence bound to the worktree committed as `42a090c`); stack @ `42a090c`; installed `@ckb-ccc/core` 1.17.0.

## 1. Inventory summary

- **Structure.** `bugs/NNN-name/` = 59 issue-ready CCC defects (`new-confirmed`), each with `issue.md` + `evidence.md` + executable `repro.mjs`. `observations/` = 15 CCC knowledge entries (`fixed-on-master`, `design-tradeoff`, `contract-unproven`, …). `BEHAVIORS.md` indexes all 74 CCC entries; `DEPENDENCIES.md` is the broader 183-entry source-targeted catalog; `findings/<source>/` holds packaged non-CCC evidence (blob-hash-bound); `candidates.md` is the candidate→disposition ledger; `CCC_RPC_HARDENING.md` is an uncounted defense-in-depth proposal (5 items).
- **Identification.** CCC bugs use bare numbers (001–074, gaps = observations); other sources use `PREFIX-NNN` (`ICKB-`, `CKB-`, `LC-`, `NERVOS-`, `PROXY-`, `CKBSTD-`, Rosen families). Evidence pins exact revisions and per-file git blob hashes.
- **CCC version verdict (verified against installed source).** `@ckb-ccc/core@1.17.0`'s changelog tops out at PR #438; the audit baseline includes PRs #444–#453. So **1.17.0 predates the audit pin: all 59 confirmed CCC defects are present in 1.17.0, and the three items the audit lists as "fixed on master" are not fixed in 1.17.0** — obs 002 slot leak (no try/finally in `src/jsonRpc/requestor.ts:132-139`), obs 019 `completeFee` prepared-tx return (#446), #445/#448 fallback skip. Re-verified in the installed package: bug 001 timer leak (`src/jsonRpc/transports/http.ts:11-24`), bug 057 (`src/ckb/transaction.ts:2783` uses `<=`, adding a full 180-epoch cycle on equal fractions), bug 053/054 pattern (`MapLru` + concurrent `Promise.all` marking in `src/client/cache/cache.ts:53-55`).
- **ICKB-017 status: classification stale, confirmed.** Its three owner blobs still match HEAD byte-for-byte, but both stated triggers are refuted by those very blobs: confirmation timeout hits `if (confirmationError.isTimeout) { continue; }` inside an unbounded `for(;;)` (re-waits the *same* hash, never replans), and `Duplicated(Byte32(` can no longer reach the retryable classifier because `signAndSendTransaction` wraps every send throw as `TransactionBroadcastError` → `broadcast_ambiguous` → same confirm loop. **ICKB-017 and ICKB-022 have effectively swapped**: 017 has current hashes with obsolete prose; 022 has dead blob hashes with prose that exactly matches current code. The live defect is the ICKB-022/C2 shape. Additional audit-side staleness: all ickb-stack evidence cites `ca51bf88`, which does not contain the audited paths (real anchor `42a090c`); ICKB-STACK-001's blob is also stale (substance re-verified intact).
- **Out of scope** (no iCKB relevance): Rosen, TSS, Neuron, Lumos, ckb-sdk-js, MMR.

## 2. Implementation-constraints table

Legend — **yes**: constrains the rewrite; **fixed**: already fixed in stack baseline; **deleted**: component doesn't survive; **no**: no surface; **CCC-bump**: fixed upstream after 1.17.0, resolve by raising the CCC floor.

### CCC core — transport, client, cache, numeric (headless sdk/bot/harness)

| Finding | Affects? | Constraint in the rewrite | Lands in |
|---|---|---|---|
| 001 http abort-timer leak (open #450) | yes | Finite processes (smoke, congruence preflight, sampler/testkit bin) set short request timeouts and/or exit explicitly; track #450 | node-utils client construction; harness smoke |
| 003 WS malformed response throws out-of-promise; obs 009/033, #444 WS defaults | yes | Hard rule (already at `node-utils/src/chain.ts:143`): explicit HTTP `url` + `fallbacks: []`; never WS for bot/harness | node-utils (one client factory) |
| obs 002 maxConcurrent slot leak (#451) | CCC-bump | Not fixed in 1.17.0; never set `maxConcurrent` until CCC floor ≥ post-#451 | node-utils client config |
| #445/#448 fallback-skip race (ICKB-009) | CCC-bump | Nullified by `fallbacks: []`; if fallbacks ever configured, require fixed CCC first | node-utils |
| obs 019 `completeFee` ignores returned prepared tx (#446; ICKB-002) | CCC-bump | Keep sdk's explicit pristine-tx/retry fee shape (`sdk_base.ts:54-77`) until CCC floor ≥ post-#446 | sdk complete/fee |
| 005 multi-digit script error code truncated (#453) | yes | Contract-error classification parses raw node error text, never CCC's parsed code | sdk send/wait error mapping; harness classifier |
| 006 out-of-range `Since.value` overwrites flags | yes (defensive) | Assert 56-bit value bound where `since` is built (`dao.ts:261`); negative fixture | dao builder; debugger fixtures |
| 007 invalid `depType` serializes as `code` | yes (low) | Validate deployment-manifest enums at config boundary | sdk deployment parsing |
| 008 byte-array fractional/NaN coercion; obs 020 unsigned wrap | yes | Keep the checked codecs (documented-keep) | codecs |
| 015 molecule decreasing offsets accepted | no today | `OrderData` is fixed-layout struct; rule: never decode untrusted cell data via CCC dynvec/table codecs without offset validation | scan-layer rule |
| 030 verbosity/withCycles modes broken (#229) | yes | Never pass verbosity 0 / `withCycles`; raw verbosity-1 polling stays | sdk wait; harness probes |
| 031/036 fixed-point custom-decimals/sign corruption | no today | Keep own `formatCkb` (documented-keep) | utils |
| 032 cache partial args/data match misses nonzero offsets | yes (low) | Re-filter scan results client-side by full script tuple | sdk scan layer |
| 037 rejected tx leaves cache outputs usable (#378) | yes | Transaction-scoped rollback; never trust CCC cache after terminal reject (with ICKB-020) | sdk send/wait |
| 053 512-entry LRU evicts pending-spend marks | yes | **Own the pending-outpoint set** in sdk/bot; CCC cache is a read accelerator, not correctness | sdk send + bot loop state |
| 054 batched `markTransactions` parent/child race | yes (latent) | Mark transactions serially in dependency order (one tx per send — keep) | sdk send |
| 055 `withData: false` caches missing data as `"0x"` | no today | All scans verified `withData: true`; make it an invariant | scan-layer rule |
| 057 `calcDaoClaimEpoch` extra 180-epoch cycle on equal fractions | yes | **Verified in installed 1.17.0.** Never migrate iCKB maturity/claim math to CCC's; equal-fraction boundary golden vector | dao (keep own math); golden vectors |
| 035 secp verify throws on malformed length | yes (interface) | Pre-validate 65-byte signatures if `verifyMessage` used | interface |
| 045 SSRI UDT missing cell deps (#227) | no | No SSRI executor path; never adopt without merging `response.cellDeps` | core (rule) |
| 016/048, 018/022/049/050, 023/046, 034, 047, 051, 065/066 | no | Lumos/Spore/DID/PWLock/Type-ID/UDT-docs/multisig paths unused | — |
| obs 004 depth-wait no inclusion recheck (ICKB-003/008) | yes | `SentTransaction.wait` keeps fresh-status waiter; recheck inclusion after reorg when depth requested | sdk wait |
| obs 017 `clear()` leaves headers/blocks; obs 026 react client | yes (interface) | New client per network; keep chain-switch auto-disconnect | interface |
| obs 024 stuck-cursor pagination | yes | Kept cursor guard + total-work budget (ICKB-001) | scan → CCC PR |
| obs 025 `addOutput` preserves identity | yes (low) | Clone cells before mutating in builders | sdk/core builders |
| obs 028 concurrent input-selection collision; obs 052 heterogeneous signing | no | Single-threaded loop, single-signer flows | — |

### CCC wallet/connector cluster (interface only)

| Finding | Affects? | Constraint |
|---|---|---|
| 010, 021, 027, 038-041, 043, 044, 063, 067, 071 | yes (interface) | Keep pinned connector-react + JoyID patch; serialize connect/disconnect/isConnected; recreate connector on chain switch; guard `ccc-connection-info` localStorage parse; dedupe EIP-6963 providers by identity; wrap REI results via `ccc.Transaction.from`; never route multi-account prepared txs through REI |
| 011-014, 029, 042, 056, 058-062, 064, 068-070, 072-074 | no | BTC/Nostr/Doge signer paths — excluded by the kept CKB-signer filter |

### iCKB stack findings (ICKB-001..025)

| Finding | Affects? | Constraint | Lands in |
|---|---|---|---|
| ICKB-001 unbounded paged scan | yes | Cursor guard **plus total item/page budget + `AbortSignal`**; stack twin of `CCC_RPC_HARDENING` item 2 — fold into the CCC upstream PR | sdk scan layer → CCC PR |
| ICKB-005 mint-honesty invariant | no (knowledge) | Attestation boundary already closes LO-01; keep | core docs |
| ICKB-007 hashless accepted send | fixed | Persist-hash-before-broadcast invariant (must-never-cut) | sdk SentTransaction |
| ICKB-010 update stops sole bot, no readiness | deleted/addressed | `Type=notify` + kept atomic-switch/rollback resolve by design | systemd |
| ICKB-011 reload loses pending ownership | yes (interface) | Keep localStorage persist+hydrate in the new pending store | interface |
| ICKB-012 log quota bypass / ICKB-024 rotation race | deleted + residual | Launcher dies; the bot CLI's ~40-line rotation enforces bounds *during* the run; readers bind by file-handle identity | bot CLI logging; watch tailing |
| ICKB-013 scans without final tip fence | yes | `snapshot()` re-reads tip after concurrent scans; mismatch → bounded rescan or staleness mark | sdk snapshot() |
| ICKB-014 interface retries forever | yes | `SentTransaction.wait({signal})` + bounded windows; interface passes a deadline | sdk wait + interface |
| ICKB-015 >u64::MAX iCKB output constructible | yes | Fail-fast assert in mint path (C10); negative debugger fixture | core; fixtures |
| ICKB-016 contracts accept trailing bytes after prefixes | yes (decision) | SDK **emits** exact-length canonical data only; prefix-tolerant decode stays deliberate with the suffix policy documented; trailing-byte golden vectors | core codecs + docs; vectors |
| ICKB-017 confirm-timeout resend | **stale — superseded by ICKB-022** | Bounded `ConfirmationPolicy` (decided) **plus** map `-1107`/`Duplicated(Byte32(` to accepted-with-known-hash, reconcile-by-hash before any replan/resend | sdk send/wait + bot |
| ICKB-018 RPC path in public identity | waived by maintainer (2026-08-10) | No credentialed-path providers in use; revisit if adopted | — |
| ICKB-019 sampler assumes monotone timestamps | yes | Fixture headers selected by number/hash (or non-monotonicity-tolerant search) | testkit sampler `--fixtures` |
| ICKB-020 rejection recovery clears whole cache | yes | Transaction-scoped rollback (or clear-and-replay surviving pending txs in dependency order); interface shares one client across pending txs | sdk wait |
| ICKB-021 max-fee guard | fixed + residual | Keep guard; ceiling becomes an application-tuned config knob | sdk send; config schema |
| ICKB-022 pre-accept broadcast error locks flow | yes | Split `TransactionBroadcastError`: definitive node rejection → terminal, release flow; ambiguous transport failure → bounded reconcile-by-hash then `broadcast_ambiguous` exit. Both bot **and** interface | sdk SentTransaction + bot + interface |
| ICKB-023 forwarded shutdown orphans group | yes | Group-kill escalation stays armed until the *group* is empty, not until the leader exits | node-utils runProcess |
| ICKB-025 best-fit misses exact subsets past 30 | deleted | Independent evidence the cut selector was also *wrong*; record in the cut rationale | rationale note |

### CKB node / protocol / deployed scripts

| Finding | Affects? | Constraint | Lands in |
|---|---|---|---|
| CKB-001 `get_cells_capacity` len-range boundary differs | yes (low) | Never treat `getCellsCapacity` as consistent with `findCells` filters | scan rule |
| CKB-002 indexer shows cells spent by own pending txs | yes | Snapshot overlays the bot's own pending-spend set (with CCC-053) | sdk scan + bot state |
| CKB-003 `estimate_cycles` resolves dead cells | no/low | Not a validity oracle | harness note |
| CKB-004 rejection node-local/lossy; unknown ≠ never-sent | yes | `broadcast_ambiguous` bailout: exhaust budget → exit 2 → fresh chain read on restart | sdk wait + bot |
| CKB-005 duplicate submit returns `-1107` | yes | Map `-1107`/`Duplicated(` to success-with-known-hash → confirmation | sdk send |
| CKB-006 committed ≠ final | yes (knowledge) | Depth-aware wait where value warrants | sdk wait docs |
| NERVOS-001 genesis DAO rejects >64 total outputs | yes (enforced) | `assertDaoOutputLimit` stays. **Fixture provenance: deployed pin `ckb-system-scripts@f25c5ae`; repo HEAD removed the cap** — a HEAD-built `dao.c` silently passes txs mainnet rejects | dao; fixtures |
| NERVOS-015 32 KiB witness cap on loaded paths | yes (harness) | Edge fixture only; not a global ceiling | fixtures |
| NERVOS-016 deployed DAO reads first byte of header-index field | yes | Assert phase-2 `headerIndex < 256` in the builder | dao builder; fixtures |
| NERVOS-002..014, CKBSTD-001..005 | knowledge | Honored by verified-clean code; encode as fixtures where cheap | fixtures |
| LC-001..013 light client | no | Full-node HTTP only; if light-client ever lands, LC-001/008 force client-side re-filtering | — |
| PROXY-001/002/003 | no (ops) | Deployment-runbook knowledge | ops docs |
| PROXY-004 trailing args change Script identity | yes (low) | Key ownership/dedup by full `Script` bytes, never parsed prefix | scan layer |

## 3. Amendments to the decision documents

1. **CCC floor**: set an explicit CCC version floor at the first release ≥ `8a19abcd` before deleting any CCC-overlapping iCKB code; until then: `fallbacks: []`, no `maxConcurrent`, keep the sdk's explicit fee-retry shape.
2. **DAO upstream list excludes claim-epoch/maturity math** (bug 057 verified in 1.17.0); add the equal-fraction boundary to golden vectors.
3. **C2/ConfirmationPolicy scope**: live defect is the ICKB-022 shape; add `-1107`→accepted-with-hash mapping, split definitive rejection from ambiguous failure with bounded reconcile-by-hash, apply on the interface path too (ICKB-014).
4. **Snapshot tip fence**: `snapshot()` re-reads the tip after concurrent scans; bounded rescan or staleness mark (~10 lines; ICKB-013).
5. **Own the pending-spend state** (new design constraint): sdk/bot keep an explicit pending-outpoint/tx set; CCC cache is a read accelerator only; rejection recovery is transaction-scoped (CCC 037/053/054, ICKB-020, CKB-002).
6. **Debugger fixture provenance**: `dao.c`/system scripts pinned to deployed genesis binaries (`ckb-system-scripts@f25c5ae`), never repo HEAD; congruence preflight sha256s system-script fixtures too.
7. **Sampler fixtures select headers by number/hash** (ICKB-019).
8. **Greedy-only call gains supporting evidence** (ICKB-025: the exact selector silently missed exact subsets past 30 candidates).
9. **node-utils survivors**: ICKB-023 group-kill fix. (ICKB-018 waived by maintainer.)
10. **Config schema gains an application-tuned `maxFeeRate` knob** (ICKB-021 residual).
11. **CCC upstreaming reuses audit material**: paged-scan budget = `CCC_RPC_HARDENING` item 2 + obs 024; wait/rejection hardening = #378 + bug 037; send-hash binding = hardening item 1.
12. **Audit bookkeeping**: re-anchor iCKB evidence to `42a090c`; re-adjudicate ICKB-017 as superseded-by ICKB-022; hand the post-rewrite tree back for the audit's scheduled re-map.
