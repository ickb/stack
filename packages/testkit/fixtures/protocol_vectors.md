# protocol_vectors.json — provenance and schema

Golden vectors computed by the iCKB contracts' own Rust logic, for cross-checking
TypeScript reimplementations. Do not edit the JSON by hand; regenerate it.

## Generation

- Generator crate: `/var/home/user/Projects/ickb/contracts/scripts/vector-gen`
- Source commit (ickb/contracts): `ae8a11fa560c157116e3f75acc316682d9cca061`
- Command:

  ```sh
  cd /var/home/user/Projects/ickb/contracts/scripts/vector-gen
  cargo run --release -- /var/home/user/Projects/ickb/stack/packages/testkit/fixtures/protocol_vectors.json
  ```

Provenance mechanism: `utils/src/c256.rs` (checked 256-bit arithmetic) and
`ickb_logic/src/constants.rs` are compiled directly from the contract sources via
`#[path]`. The two protocol functions, `deposit_to_ickb`
(`ickb_logic/src/entry.rs:71-84`) and `validate` plus its order types
(`limit_order/src/entry.rs:86-133,141-161`), are private and syscall-bound, so the
generator embeds byte-exact copies (`src/copied/*.rs`) and asserts at generation
time that each copy is still a substring of its source file — drift aborts
generation. The only syscall shim is `extract_accumulated_rate`, replaced by a
`Source { ar }` carrier so the copied `deposit_to_ickb` compiles unchanged.

## Schema

All big integers are decimal strings.

`depositToIckb` rows: `{arDecimal, unoccupiedShannons, expectedIckb, note}` —
`expectedIckb = deposit_to_ickb(unoccupiedShannons)` at DAO accumulated rate
`arDecimal` (AR_0 = 10^16), including the 10% discount past the 100k-iCKB soft cap.

`limitOrderMatch` rows:
`{ckbToUdt, udtToCkb, ckbMinMatchLog, input, output, verdict, note}` where each
ratio is `{ckbMul, udtMul}` or `null`, sides are `{ckb, udt, ckbUnoccupied}`, and
`verdict` is `"ok"` or the contract `Error` variant name from `validate`.

## Semantics notes

- The row schema mirrors the contract's `Info` with two optional ratio slots
  (instead of a single `ratio` field): `validate` selects the slot by which asset
  decreased, and the dual-ratio and wrong-direction rows are inexpressible with
  one ratio.
- `validate`'s UDT→CKB `AttemptToChangeFulfilled` branch is unreachable: that arm
  requires `input.udt > output.udt`, impossible when `input.udt == 0`. A fulfilled
  UDT→CKB order therefore surfaces as `InvalidMatch` (see the row noting this).
- Deposit bound rows (1000 CKB min, 1M CKB max) exercise the conversion math only;
  the bounds themselves are enforced by `check_output`, not `deposit_to_ickb`.
- `input.ckb >= input.ckbUnoccupied` and a constant occupied capacity are kept
  where physically meaningful, but `validate` itself does not cross-check them;
  a few rows (e.g. fulfilled-mutation attempts) are deliberately synthetic.
