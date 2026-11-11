// The README code is the files in sdk/examples, which the gate typechecks: each README
// shows its examples verbatim, so a reader never copies code that no longer compiles.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

for (const [readme, example] of [
  ["README.md", "convert.ts"],
  ["sdk/README.md", "client.ts"],
  ["sdk/README.md", "convert.ts"],
  ["sdk/README.md", "dates_and_history.ts"],
] as const) {
  void test(`${readme} shows ${example} as it is`, () => {
    const code = read(`sdk/examples/${example}`).trimEnd();
    const block = ["```ts", code, "```"].join("\n");
    assert.ok(read(readme).includes(block));
  });
}
