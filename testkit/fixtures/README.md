# Protocol Vectors

`protocol_vectors.json` holds golden vectors computed by the Rust logic of the iCKB contracts. They cross-check the TypeScript reimplementations. Don't edit the JSON by hand: regenerate it.

## Generation

`scripts/vector-gen` in ickb/contracts generates it, at commit `c951927e35fb5d4a13e28c5e55687d49cea7ca05`. The [vector-gen README](https://github.com/ickb/contracts/blob/c951927e35fb5d4a13e28c5e55687d49cea7ca05/scripts/vector-gen/README.md) owns how the generator stays faithful to the contract sources. It also owns how to regenerate this file from a contracts checkout next to this repository.

Regenerating at that commit on 2026-09-27 reproduced the committed file byte for byte (SHA-256 `349d7c0f519c6ced828af963d79a53819a23f6e02cb52140e8ed052b30102eb3`).

## Deployed binaries

Checked on 2026-09-15:

- `scripts/build/release/{ickb_logic,limit_order,owned_owner,xudt}` hash (`ccc.hashCkb`) to the four `data1` code hashes in `sdk/src/constants.ts`.
- Every code cell in the mainnet and testnet dep groups carries data with those hashes.
- The binaries and contract sources at `c951927e` are identical to deployed commit `454cfa96`.

To recreate: pipe `git cat-file blob <commit>:<path>` into `ccc.hashCkb`, then `getCell` each dep-group entry.

## Schema

All big integers are decimal strings.

- **`depositToIckb` rows:** `{arDecimal, unoccupiedShannons, expectedIckb, note}`. `expectedIckb = deposit_to_ickb(unoccupiedShannons)` at DAO accumulated rate `arDecimal` (AR_0 = 10^16), including the 10% discount past the 100k-iCKB soft cap.
- **`limitOrderMatch` rows:** `{ckbToUdt, udtToCkb, ckbMinMatchLog, input, output, verdict, note}`. Each ratio is `{ckbMul, udtMul}` or `null`. Sides are `{ckb, udt, ckbUnoccupied}`. `verdict` is `"ok"` or the name of the contract `Error` variant from `validate`.

## Semantics notes

- The row schema mirrors the contract `Info` with two optional ratio slots instead of one `ratio` field. `validate` picks the slot by which asset decreased. The dual-ratio and wrong-direction rows can't be expressed with one ratio.
- The UDT to CKB `AttemptToChangeFulfilled` branch of `validate` is unreachable: that arm requires `input.udt > output.udt`, impossible when `input.udt == 0`. So a fulfilled UDT to CKB order surfaces as `InvalidMatch` (a row notes this).
- Deposit bound rows (1000 CKB min, 1M CKB max) exercise the conversion math only. `check_output` enforces the bounds, not `deposit_to_ickb`.
- Rows keep `input.ckb >= input.ckbUnoccupied` and a constant occupied capacity where physically meaningful. `validate` itself doesn't cross-check them, so a few rows (fulfilled-mutation attempts, for one) are deliberately synthetic.
