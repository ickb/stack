import assert from "node:assert/strict";
import test from "node:test";
import { changedRanges, isMutated } from "../../tooling/mutate-changed.ts";

const globs = [
  "sdk/src/**/*.ts",
  "sdk/node/src/**/*.ts",
  "!sdk/node/src/{bot,stimulus}.ts",
];

void test("isMutated reads the globs in order, a ! glob removing what earlier ones added", () => {
  assert.equal(isMutated("sdk/src/sdk.ts", globs), true);
  assert.equal(isMutated("sdk/node/src/bot/match.ts", globs), true);
  assert.equal(isMutated("sdk/node/src/bot.ts", globs), false);
  assert.equal(isMutated("sdk/test/sdk.ts", globs), false);
  // Stryker reads in order: a later glob adds back what an earlier ! glob removed.
  assert.equal(isMutated("a.ts", ["!a.ts", "*.ts"]), true);
});

void test("changedRanges turns added hunks of selected files into Stryker ranges", () => {
  const diff = [
    "diff --git a/sdk/src/sdk.ts b/sdk/src/sdk.ts",
    "--- a/sdk/src/sdk.ts",
    "+++ b/sdk/src/sdk.ts",
    "@@ -10,2 +10,3 @@ export class IckbSdk {",
    "@@ -40 +41 @@",
    "@@ -50,4 +51,0 @@",
    "diff --git a/sdk/node/src/bot.ts b/sdk/node/src/bot.ts",
    "+++ b/sdk/node/src/bot.ts",
    "@@ -1 +1 @@",
    "diff --git a/sdk/src/gone.ts b/sdk/src/gone.ts",
    "+++ /dev/null",
    "@@ -1,3 +0,0 @@",
    "diff --git a/sdk/src/new.ts b/sdk/src/new.ts",
    "--- /dev/null",
    "+++ b/sdk/src/new.ts",
    "@@ -0,0 +1,2 @@",
    "",
  ].join("\n");

  assert.deepEqual(changedRanges(diff, globs), [
    "sdk/src/sdk.ts:10-12",
    "sdk/src/sdk.ts:41-41",
    "sdk/src/new.ts:1-2",
  ]);
});
