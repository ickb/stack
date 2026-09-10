import { ccc, mol } from "@ckb-ccc/core";
import { Relative, type RelativeLike } from "./relative.ts";

const MasterCodec = mol.union({
  relative: Relative,
  absolute: ccc.OutPoint,
});

/**
 * Master pointer before normalization.
 *
 * @public
 */
export type MasterLike =
  | { type: "relative"; value: RelativeLike }
  | { type: "absolute"; value: ccc.OutPointLike };

/**
 * Master pointer stored in order data.
 *
 * @public
 */
export type Master =
  { type: "relative"; value: Relative } | { type: "absolute"; value: ccc.OutPoint };

/** Normalizes a master pointer into entity values. */
export function masterFrom(master: MasterLike): Master {
  const { type, value } = master;
  return type === "relative"
    ? { type, value: Relative.from(value) }
    : { type, value: ccc.OutPoint.from(value) };
}

/** Validates a normalized master pointer. */
export function masterValidate(master: Master): void {
  const { type, value } = master;
  if (type === "relative") {
    value.validate();
  } else if (!/^0x[0-9a-f]{64}$/i.test(value.txHash) || value.index < 0) {
    throw new Error("OutPoint invalid");
  }
}

export { MasterCodec };
