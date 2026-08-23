import { ESLint } from "eslint";
import assert from "node:assert/strict";
import test from "node:test";

const oraclePath = "packages/testkit/src/contract_oracle.ts";
const staticMessage = "The contract oracle must not import or re-export dependencies.";
const dynamicMessage = "The contract oracle must not load dependencies dynamically.";
const referenceMessage =
  "The contract oracle must not reference dependency declarations.";
const typeMessage =
  "The contract oracle must not reference dependencies through import types.";

void test("contract oracle rejects every owned dependency syntax", async () => {
  const eslint = new ESLint();
  const cases = [
    ['import value from "dependency";', staticMessage],
    ['import type { Value } from "dependency";', staticMessage],
    ['export { value } from "dependency";', staticMessage],
    ['export * from "dependency";', staticMessage],
    ['void import("dependency");', dynamicMessage],
    ['type Value = import("dependency").Value;', typeMessage],
    ['const value = require("dependency");', dynamicMessage],
    [
      'const loader = process.getBuiltinModule("node:module").createRequire(import.meta.url);\nconst value = loader("dependency");',
      dynamicMessage,
    ],
    ['/// <reference path="dependency.d.ts" />\nconst value = 1;', referenceMessage],
    ['/// <reference types = "node" />\nconst value = 1;', referenceMessage],
    [
      '/// <reference preserve="true" types="node" />\nconst value = 1;',
      referenceMessage,
    ],
    ['/// <REFERENCE path="dependency.d.ts" />\nconst value = 1;', referenceMessage],
  ] as const;

  for (const [source, expected] of cases) {
    assert.ok(
      (await messages(eslint, source)).some((message) => message.includes(expected)),
      source,
    );
  }
});

void test("contract oracle keeps inherited syntax restrictions", async () => {
  const eslint = new ESLint();
  assert.ok(
    (await messages(eslint, "const value = 1 as number;")).includes(
      "Avoid type assertions. If this cast is justified, add a local ESLint disable with the reason.",
    ),
  );
});

void test("contract oracle cannot disable its dependency guard", async () => {
  const eslint = new ESLint();
  const cases = [
    [
      '// eslint-disable-next-line no-restricted-imports -- attempted bypass\nimport value from "dependency";',
      staticMessage,
    ],
    [
      '/* eslint-disable oracle-independence/no-dependency-loading -- attempted bypass */\nvoid import("dependency");',
      dynamicMessage,
    ],
  ] as const;

  for (const [source, expected] of cases) {
    assert.ok(
      (await messages(eslint, source)).some((message) => message.includes(expected)),
      source,
    );
  }
});

void test("real contract oracle passes lint", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintFiles([oraclePath]);
  assert.deepEqual(result?.messages ?? [], []);
});

async function messages(eslint: ESLint, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: oraclePath });
  return (result?.messages ?? []).map(({ message }) => message);
}
