import assert from "node:assert/strict";
import test from "node:test";
import type { Failure } from "../../../../tooling/lint/source-structure/model.ts";
import { checkSourcePolicyRules } from "../../../../tooling/lint/source-structure/policy/source.ts";

const sourceFile = "packages/example/src/example.ts";

void test("recognizes cell scans through every supported receiver shape", () => {
  for (const call of [
    "client.findCells(query, pageSize)",
    "getClient().findCells(query, pageSize)",
    "this.findCells(query, pageSize)",
    "(await getClient()).findCellsOnChain(query, pageSize)",
    'client["findCells"](query, pageSize)',
  ]) {
    assert.deepEqual(ruleNames(`async function scan() { ${call}; }`), ["pagedCellScan"]);
  }
});

void test("accepts findCellsPaged only under the cursor-owning page collector", () => {
  assert.deepEqual(
    ruleNames(
      "async function scan() { await collectPagedScan((pageSize, after) => getClient().findCellsPaged(query, 'asc', pageSize, after), { pageSize }); }",
    ),
    [],
  );
  assert.deepEqual(
    ruleNames(
      "async function scan() { await client.findCellsPaged(query, 'asc', pageSize, after); }",
    ),
    ["pagedCellScan"],
  );
  assert.deepEqual(
    ruleNames(
      "async function scan() { await collectPagedScan(() => client.findCellsPaged(query), { pageSize }); }",
    ),
    ["pagedCellScanPageSize"],
  );
  assert.deepEqual(
    ruleNames(
      "async function scan() { for await (const cell of client.cache.findCells(query)) {} }",
    ),
    [],
  );
});

void test("rejects production files split by letter or part suffix", () => {
  for (const file of [
    "packages/example/src/classificationA.ts",
    "packages/example/src/classificationPart2.ts",
    "apps/example/src/run_part.tsx",
  ]) {
    assert.deepEqual(ruleNamesFor(file), ["sizeSplitSourceName"]);
  }
  for (const file of [
    "packages/example/src/base64.ts",
    "packages/example/src/classification.ts",
    "packages/example/test/classificationA.ts",
    "packages/testkit/src/fakeA.ts",
  ]) {
    assert.deepEqual(ruleNamesFor(file), []);
  }
});

function ruleNamesFor(file: string): string[] {
  const failures: Failure[] = [];
  checkSourcePolicyRules(new Map([[file, "export const value = 1;"]]), failures);
  return failures.map((failure) => failure.rule);
}

function ruleNames(source: string): string[] {
  const failures: Failure[] = [];
  checkSourcePolicyRules(new Map([[sourceFile, source]]), failures);
  return failures.map((failure) => failure.rule);
}
