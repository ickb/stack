// Contract oracle: a freestanding TypeScript port of the on-chain Rust validation
// rules, used as an independent adjudicator in tests. It intentionally imports
// NOTHING (no @ickb/*, no CCC) so it cannot inherit a defect from the
// implementation it judges; a lint rule will enforce this independence.
//
// Sources of truth (contracts checkout, commit-pinned by the review docs):
// - contracts/scripts/contracts/limit_order/src/entry.rs
//   - validate(): lines 86-133
//   - ckb_min_match decoding: lines 221-224
// - contracts/scripts/contracts/ickb_logic/src/entry.rs
//   - deposit_to_ickb(): lines 71-84
// - contracts/scripts/contracts/ickb_logic/src/constants.rs:7 (ICKB_SOFT_CAP_PER_DEPOSIT)
// - contracts/scripts/contracts/utils/src/constants.rs:20 (GENESIS_ACCUMULATED_RATE)
//
// The Rust uses C256 checked arithmetic (utils/src/c256.rs); TypeScript bigints are
// unbounded, so the checked-overflow abort cannot fire here. All on-chain operands
// originate from u64/u128 fields, whose products fit far below 2^256.

/**
 * On-chain state of one limit-order cell, in base units.
 *
 * Mirrors the amount fields of `Data` (entry.rs:141-147); `info` lives separately in
 * {@link OracleInfo}. All values are non-negative integers on-chain (u64 capacities,
 * u128 UDT amounts); the oracle assumes callers respect that domain.
 */
export interface OrderState {
  /** Total cell capacity in shannons (`Data.ckb`, entry.rs:143). */
  ckb: bigint;
  /** UDT amount in UDT base units (`Data.udt`, entry.rs:144). */
  udt: bigint;
  /** Capacity minus occupied capacity, in shannons (`Data.ckb_unoccupied`, entry.rs:145). */
  ckbUnoccupied: bigint;
}

/**
 * Exchange ratio: one UDT base unit is worth `udtMul / ckbMul` shannons.
 *
 * Mirrors `Ratio` (entry.rs:157-161).
 */
export interface OracleRatio {
  /** Multiplier applied to CKB amounts (`Ratio.ckb_mul`, entry.rs:159). */
  ckbMul: bigint;
  /** Multiplier applied to UDT amounts (`Ratio.udt_mul`, entry.rs:160). */
  udtMul: bigint;
}

/**
 * Order terms shared by the matched input and output cells.
 *
 * Mirrors `Info` (entry.rs:149-155) minus `udt_hash`. The contract requires input and
 * output info to be identical before matching (entry.rs:87-89); the oracle takes the
 * shared info once and does not re-check that equality. An absent ratio mirrors the
 * Rust `None`: that direction is disabled. Encoding-time invariants (ratio zero/null
 * rules, concavity, log range; entry.rs:209-239) are not re-validated here.
 */
export interface OracleInfo {
  /** CKB to UDT ratio, absent when that direction is disabled (entry.rs:152). */
  ckbToUdt?: OracleRatio;
  /** UDT to CKB ratio, absent when that direction is disabled (entry.rs:153). */
  udtToCkb?: OracleRatio;
  /** Minimum CKB moved per partial match, `1n << log` (entry.rs:154, 221-224). */
  ckbMinMatch: bigint;
}

/**
 * Outcome of {@link validateMatch}: `"ok"` for `Ok(())`, otherwise the name of the
 * Rust `Error` variant the contract would raise.
 */
export type OracleVerdict =
  | "ok"
  | "InvalidMatch"
  | "DecreasingValue"
  | "AttemptToChangeFulfilled"
  | "InsufficientMatch";

/**
 * Derives `ckb_min_match` from its encoded log2 (entry.rs:221-224).
 *
 * @param ckbMinMatchLog - Encoded exponent; the contract accepts 0 to 64 inclusive.
 * @returns `1n << ckbMinMatchLog`, in shannons.
 * @throws Error - `"InvalidCkbMinMatchLog"` outside 0 to 64, mirroring entry.rs:223.
 */
export function ckbMinMatchFromLog(ckbMinMatchLog: number): bigint {
  if (!Number.isInteger(ckbMinMatchLog) || ckbMinMatchLog < 0 || ckbMinMatchLog > 64) {
    // entry.rs:223 — any byte outside 0..=64 is Error::InvalidCkbMinMatchLog.
    throw new Error("InvalidCkbMinMatchLog");
  }

  // entry.rs:222 — n @ 0..=64 => C256::from(1u128 << n).
  return 1n << BigInt(ckbMinMatchLog);
}

/**
 * Ports the limit-order match rules, `validate()` (entry.rs:86-133), verbatim.
 *
 * @param input - State of the order cell consumed by the match.
 * @param output - State of the order cell produced by the match, same master.
 * @param info - Order terms shared by both cells (see {@link OracleInfo}).
 * @returns The verdict the on-chain script would produce for this pair.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Verbatim port of the on-chain validate() control flow (entry.rs:86-133); restructuring for the metric would break the line-by-line auditability against the deployed Rust that this oracle exists to provide.
export function validateMatch(
  input: OrderState,
  output: OrderState,
  info: OracleInfo,
): OracleVerdict {
  // entry.rs:91-100 — direction determination over the tuple
  // (i.info.ckb_to_udt, i.ckb > o.ckb, i.info.udt_to_ckb, i.udt > o.udt).
  const ckbShrinks = input.ckb > output.ckb;
  const udtShrinks = input.udt > output.udt;

  let isCkbToUdt: boolean;
  let ratio: OracleRatio;
  if (info.ckbToUdt !== undefined && ckbShrinks && !udtShrinks) {
    // entry.rs:97 — (Some(ratio), true, _, false): CKB -> UDT.
    isCkbToUdt = true;
    ratio = info.ckbToUdt;
  } else if (!ckbShrinks && info.udtToCkb !== undefined && udtShrinks) {
    // entry.rs:98 — (_, false, Some(ratio), true): UDT -> CKB.
    isCkbToUdt = false;
    ratio = info.udtToCkb;
  } else {
    // entry.rs:99 — every other flag combination.
    return "InvalidMatch";
  }
  const { ckbMul, udtMul } = ratio;

  // entry.rs:103-105 — the order must not lose value at its own ratio;
  // exact equality passes.
  if (
    input.ckb * ckbMul + input.udt * udtMul >
    output.ckb * ckbMul + output.udt * udtMul
  ) {
    return "DecreasingValue";
  }

  if (isCkbToUdt) {
    // entry.rs:111-113 — a fulfilled CKB -> UDT order (no unoccupied CKB left to
    // convert) is immutable.
    if (input.ckbUnoccupied === 0n) {
      return "AttemptToChangeFulfilled";
    }

    // entry.rs:116-117 — DOS prevention: unless the output is fulfilled, the CKB
    // moved must be at least ckb_min_match. The bound is a plain CKB delta,
    // NOT converted through the ratio (defect review C1).
    if (output.ckbUnoccupied !== 0n && input.ckb < output.ckb + info.ckbMinMatch) {
      return "InsufficientMatch";
    }
  } else {
    // entry.rs:122-123 — a fulfilled UDT -> CKB order (no UDT left) is immutable.
    // Note: for non-negative amounts entry.rs:98 already required i.udt > o.udt >= 0,
    // so this guard is unreachable on-chain; ported verbatim regardless.
    if (input.udt === 0n) {
      return "AttemptToChangeFulfilled";
    }

    // entry.rs:127-128 — DOS prevention: unless the output is fulfilled, the UDT
    // value moved must be at least the value of ckb_min_match.
    if (
      output.udt !== 0n &&
      input.udt * udtMul < output.udt * udtMul + info.ckbMinMatch * ckbMul
    ) {
      return "InsufficientMatch";
    }
  }

  // entry.rs:132 — Ok(()).
  return "ok";
}

/**
 * Genesis accumulated rate `AR_0`.
 *
 * `GENESIS_ACCUMULATED_RATE` (utils/src/constants.rs:20).
 */
export const AR_0 = 10_000_000_000_000_000n;

/**
 * Soft cap per deposit, 100_000 iCKB in base units.
 *
 * `ICKB_SOFT_CAP_PER_DEPOSIT` (ickb_logic/src/constants.rs:7).
 */
export const ICKB_SOFT_CAP = 100_000n * 100_000_000n;

/**
 * Ports `deposit_to_ickb()` (ickb_logic entry.rs:71-84): AR_0-based conversion with a
 * 10% discount on the amount exceeding the soft cap.
 *
 * @param unoccupiedShannons - Deposit unused capacity in shannons (u64 on-chain,
 * entry.rs:71-72).
 * @param ar - Accumulated rate `AR_m` of the deposit's block (entry.rs:74).
 * @returns The iCKB amount in base units.
 */
export function depositToIckb(unoccupiedShannons: bigint, ar: bigint): bigint {
  // entry.rs:76 — amount * ar_0 / ar_m in u128; bigint division truncates
  // identically for non-negative operands.
  const ickbAmount = (unoccupiedShannons * AR_0) / ar;

  // entry.rs:79-81 — strictly-greater cap check, then floor(excess / 10) discount.
  if (ickbAmount > ICKB_SOFT_CAP) {
    return ickbAmount - (ickbAmount - ICKB_SOFT_CAP) / 10n;
  }

  // entry.rs:83 — at or below the cap the conversion is undiscounted.
  return ickbAmount;
}
