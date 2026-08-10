# root-export-floor

Consumer fixture for the root export contract of
`docs/reviews/2026-08-10T00-12-04Z-final-decisions.md` §1 as amended by §7
(review finding F-006): every name a community bot or wallet integration is
promised must actually be importable.

## What it checks (pre-merge mode, current)

`manifest.json` lists the root-contract export names. Each entry maps a name to
the current package that owns it (`owner`), or `owner: null` for names the
record promises but no package implements yet (Phase-2 Snapshot API, entity
bases, fee/output-limit constants). `kind` records whether the name must be a
runtime value or may be type-only; `expectedMissing` marks the recorded
pre-merge gaps so they stay visible without masking new regressions.

```sh
node scripts/tooling/probes/root-export-floor/check.ts
```

The check generates a consumer module per owner under `scratch/` (gitignored
here, always removed afterwards) and typechecks it with the repo's `tsgo`
against the root `tsconfig.json`:

- `export type { ...names } from "<package barrel>"` verifies each name exists,
  including type-only exports (`Match`, `IckbDepositCell`, ...), which a
  runtime import cannot observe;
- `export type ValueOf_<name> = typeof barrel.<name>` verifies every
  `kind: "value"` name is a runtime value, so a type-only impostor cannot
  satisfy the floor.

Output is one line per name: `OK`, `KNOWN-MISSING` (recorded pre-merge gap,
does not fail), `MISSING` (new regression, fails), `NOT-A-VALUE` (value name
exported as type only, fails), `RESOLVED` (a recorded gap is now exported —
remove its `expectedMissing` flag, fails until the manifest is updated), or
`PENDING` (no current owner, does not fail). The recorded gaps as of 2026-08-10
are `receiptCellFrom` and `ickbValue` (core barrel), `MAX_DIRECT_DEPOSITS`
(sdk barrel), and `CKB_RESERVE` (bot barrel).

## Phase-3a re-point (mandatory exit gate)

After the Phase-3a package merge, this check re-points at the single packed
`@ickb/sdk` artifact, publint-style (`--pack`): pack the tarball, install it
into a scratch consumer, and import every floor name from `"@ickb/sdk"` — the
manifest's per-package `owner` mapping collapses to the one root barrel. From
that point on this check is the **mandatory Phase-3a exit gate** (final
decisions amendment §5/§6): the merge is not done while any floor name is
missing from the packed artifact.

Names the record reserves without fixing yet (Snapshot result unions, the
`IckbError` code union, per-entity `<X>Base` consts) must be appended to
`manifest.json` when Phase 2 fixes their names.
