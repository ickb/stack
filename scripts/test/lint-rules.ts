import { ESLint } from "eslint";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// A production source file, so the production-only bans apply too; lintText lints the
// snippet in its place, through the repository's own config.
const filePath = path.join(rootDir, "sdk/src/build.ts");
const eslint = new ESLint({ cwd: rootDir });

// A selector that matches nothing reports nothing, without a warning: each rule needs, for
// every branch of its selector and every cell-read method it bans, a snippet it must catch,
// and one it must leave alone.
const cases: Array<{ rule: string; message: string; bad: string[]; good: string }> = [
  {
    rule: "no-restricted-syntax",
    message: "Do not compare script identity field by field.",
    bad: [
      'export const isZero = (script: { codeHash: string }): boolean => script.codeHash === "0x";',
      'export const isType = (script: { hashType: string }): boolean => "type" === script.hashType;',
      'export const isEmpty = (script: { args: string }): boolean => script["args"] === "0x";',
      'export const isZero = (script: { codeHash: string }): boolean => "0x" === script["codeHash"];',
    ],
    good: 'export const isZero = (script: { name: string }): boolean => script.name === "0x";',
  },
  {
    rule: "no-restricted-syntax",
    message: "Avoid type assertions.",
    bad: ["export const one = 1 as number;", "export const one = <number>1;"],
    good: "export const one = [1] as const;",
  },
  {
    rule: "no-restricted-syntax",
    message: "Parse untyped input into a declared type",
    bad: ["export type Bag = Record<string, unknown>;"],
    good: "export type Bag = Record<string, number>;",
  },
  {
    rule: "no-restricted-syntax",
    message: "An injectable dependency bag exists only to be mocked.",
    bad: [
      "export interface SendDependencies {\n  retries: number;\n}",
      "export type SendDependency = number;",
    ],
    good: "export interface SendOptions {\n  retries: number;\n}",
  },
  {
    rule: "no-restricted-syntax",
    message: "An optional `typeof realFunction` slot is a mock seam.",
    bad: [
      "export function send(): void {}\nexport interface Options {\n  send?: typeof send;\n}",
    ],
    good: "export function send(): void {}\nexport interface Options {\n  send: typeof send;\n}",
  },
  {
    rule: "no-restricted-syntax",
    message: "A parameter defaulting to a real implementation or a process global",
    bad: [
      "export function run(log: () => void = Date.now): void {\n  log();\n}",
      "export function argv(args = process.argv): string[] {\n  return args;\n}",
      "export function since(start = process.hrtime.bigint()): bigint {\n  return start;\n}",
    ],
    good: "export function argv(args: string[] = []): string[] {\n  return args;\n}",
  },
  {
    rule: "no-restricted-syntax",
    message: "Read cells through the SDK's findCells helper",
    bad: [
      "export async function scan(client: { findCellsOnChain(): Promise<void> }): Promise<void> {\n  await client.findCellsOnChain();\n}",
      "export async function scan(client: { findCellsPaged(): Promise<void> }): Promise<void> {\n  await client.findCellsPaged();\n}",
      "export async function scan(client: { findCellsPagedNoCache(): Promise<void> }): Promise<void> {\n  await client.findCellsPagedNoCache();\n}",
      "export async function scan(client: { findCells(): Promise<void> }): Promise<void> {\n  await client.findCells();\n}",
    ],
    good: "export async function scan(client: { cache: { findCells(): Promise<void> } }): Promise<void> {\n  await client.cache.findCells();\n}",
  },
  {
    rule: "no-restricted-syntax",
    message: "Return an expected outcome as { ok: false, reason }",
    bad: ["export class SendError extends Error {}"],
    good: 'export const sendError = new Error("send failed");',
  },
  {
    rule: "local/no-pure-in-static-block",
    message: "Do not use a @__PURE__ annotation inside a class static block.",
    bad: [
      "export class Codec {\n  static {\n    /* @__PURE__ */ Object.freeze({});\n  }\n}",
    ],
    good: "export const codec = /* @__PURE__ */ Object.freeze({});",
  },
];

async function reports(code: string, rule: string, message: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(result !== undefined, "ESLint returned no result");
  return result.messages.filter(
    (reported) => reported.ruleId === rule && reported.message.startsWith(message),
  ).length;
}

for (const { rule, message, bad, good } of cases) {
  void test(`${rule} reports "${message}" once per bad snippet and never on its good one`, async () => {
    for (const code of bad) {
      assert.equal(await reports(code, rule, message), 1, code);
    }
    assert.equal(await reports(good, rule, message), 0);
  });
}
