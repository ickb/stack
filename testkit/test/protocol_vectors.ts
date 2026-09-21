import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ckbMinMatchFromLog,
  depositToIckb,
  validateMatch,
  type OracleInfo,
  type OracleRatio,
  type OrderState,
} from "../src/index.ts";

/**
 * Cross-adjudicates the TypeScript contract oracle against the Rust-generated
 * golden vectors (fixtures/protocol_vectors.json, produced by the contracts
 * repo's vector-gen crate from byte-exact copies of the deployed sources). The
 * two sides were derived independently; disagreement means one port drifted.
 */

interface DepositRow {
  arDecimal: bigint;
  unoccupiedShannons: bigint;
  expectedIckb: bigint;
  note: string;
}

interface MatchRow {
  info: OracleInfo;
  input: OrderState;
  output: OrderState;
  verdict: string;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bigintField(record: Record<string, unknown>, key: string): bigint {
  const value = record[key];
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new TypeError(`Vector field ${key} is not a decimal string`);
  }
  return BigInt(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`Vector field ${key} is not a string`);
  }
  return value;
}

function rows(value: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw new Error(`Vector file lacks array ${key}`);
  }
  return value[key].filter(isRecord);
}

function ratioField(
  record: Record<string, unknown>,
  key: string,
): OracleRatio | undefined {
  const value = record[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Vector field ${key} is not a ratio`);
  }
  return { ckbMul: bigintField(value, "ckbMul"), udtMul: bigintField(value, "udtMul") };
}

function stateField(record: Record<string, unknown>, key: string): OrderState {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Vector field ${key} is not a state`);
  }
  return {
    ckb: bigintField(value, "ckb"),
    udt: bigintField(value, "udt"),
    ckbUnoccupied: bigintField(value, "ckbUnoccupied"),
  };
}

function logField(record: Record<string, unknown>): number {
  const value = record["ckbMinMatchLog"];
  if (typeof value !== "number") {
    throw new TypeError("Vector field ckbMinMatchLog is not a number");
  }
  return value;
}

const vectorsPath = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "protocol_vectors.json",
);
const parsed: unknown = JSON.parse(await readFile(vectorsPath, "utf8"));

const depositRows: DepositRow[] = rows(parsed, "depositToIckb").map((row) => ({
  arDecimal: bigintField(row, "arDecimal"),
  unoccupiedShannons: bigintField(row, "unoccupiedShannons"),
  expectedIckb: bigintField(row, "expectedIckb"),
  note: stringField(row, "note"),
}));

const matchRows: MatchRow[] = rows(parsed, "limitOrderMatch").map((row) => ({
  info: {
    ckbToUdt: ratioField(row, "ckbToUdt"),
    udtToCkb: ratioField(row, "udtToCkb"),
    ckbMinMatch: ckbMinMatchFromLog(logField(row)),
  },
  input: stateField(row, "input"),
  output: stateField(row, "output"),
  verdict: stringField(row, "verdict"),
  note: stringField(row, "note"),
}));

describe("contract oracle versus Rust golden vectors", () => {
  it.each(depositRows)("depositToIckb: $note", (row) => {
    expect(depositToIckb(row.unoccupiedShannons, row.arDecimal)).toBe(row.expectedIckb);
  });

  it.each(matchRows)("validateMatch: $note", (row) => {
    expect(validateMatch(row.input, row.output, row.info)).toBe(row.verdict);
  });

  it("covers both vector families completely", () => {
    expect(depositRows).toHaveLength(24);
    expect(matchRows).toHaveLength(36);
  });
});
