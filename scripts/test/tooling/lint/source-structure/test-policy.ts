import assert from "node:assert/strict";
import test from "node:test";
import type { Failure } from "../../../../tooling/lint/source-structure/model.ts";
import { checkTestPolicyRules } from "../../../../tooling/lint/source-structure/policy/test.ts";

const testFile = "packages/example/test/example.ts";
const complianceOnlyRule = "complianceOnlyTestSuite";

void test("flags no-error-only assertions", () => {
  assert.deepEqual(
    ruleNames(`test("does not throw", () => { assert.doesNotThrow(load); });`),
    [complianceOnlyRule],
  );
});

void test("flags no-rejection and ifError assertions", () => {
  assert.deepEqual(
    ruleNames(`
      test("does not reject", async () => { await assert.doesNotReject(run); });
      test("if error", () => { assert.ifError(error); });
    `),
    [complianceOnlyRule, complianceOnlyRule],
  );
});

void test("allows no-error assertions with concrete behavior", () => {
  assert.deepEqual(
    ruleNames(`
      test("concrete behavior", () => {
        assert.doesNotThrow(load);
        assert.equal(value(), 1);
      });
    `),
    [],
  );
});

void test("checks parent and child assertions independently", () => {
  assert.deepEqual(
    ruleNames(`
      test("parent", async (t) => {
        assert.equal(value(), 1);
        await t.test("child", () => { assert.doesNotThrow(load); });
      });
    `),
    [complianceOnlyRule],
  );
});

void test("rejects enabled or obscured Vitest options", () => {
  for (const options of [
    "{ fails: true }",
    "{ retry: 2 }",
    '{ ["retry"]: 2 }',
    "{ [optionName]: 2 }",
    "{ ...options }",
    "options",
  ]) {
    assert.deepEqual(
      ruleNames(`test.concurrent("case", ${options}, () => { assert.equal(1, 1); });`),
      ["testRunModifier"],
    );
  }
});

void test("allows disabled inline Vitest options and callback timeouts", () => {
  assert.deepEqual(
    ruleNames(`
      test("disabled", { fails: false, retry: 0 }, () => { assert.equal(1, 1); });
      test("timeout", () => { assert.equal(1, 1); }, timeoutMs);
    `),
    [],
  );
});

void test("rejects reserved Vitest options with named callbacks", () => {
  assert.deepEqual(
    ruleNames(`
      test("expected failure", { fails: true }, run);
      test("retried", { retry: 2 }, run);
      test("asserted", { fails: true } as const, run);
      test("satisfied", { retry: 2 } satisfies TestOptions, run);
    `),
    ["testRunModifier", "testRunModifier", "testRunModifier", "testRunModifier"],
  );
});

void test("applies suite aliases to modifier and repeated-title policy", () => {
  assert.deepEqual(ruleNames(`suite.concurrent("group", { retry: 2 }, run);`), [
    "testRunModifier",
  ]);
  const failures: Failure[] = [];
  checkTestPolicyRules(
    new Map([
      ["packages/example/test/first.ts", `const TITLE = "group"; suite(TITLE, run);`],
      ["packages/example/test/second.ts", `const TITLE = "group"; suite(TITLE, run);`],
    ]),
    failures,
  );
  assert.deepEqual(
    failures.map(({ rule }) => rule),
    ["repeatedTestSuiteConstant", "repeatedTestSuiteConstant"],
  );
});

function ruleNames(source: string): string[] {
  const failures: Failure[] = [];
  checkTestPolicyRules(new Map([[testFile, source]]), failures);
  return failures.map((failure) => failure.rule);
}
