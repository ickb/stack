import { ESLint } from "eslint";
import assert from "node:assert/strict";
import test from "node:test";

const filePath = "scripts/test/tooling/eslint/finite-transaction-wait.ts";

void test("rejects literal infinite transaction waits", async () => {
  const eslint = new ESLint();
  const messages = await restrictedSyntaxMessages(
    eslint,
    'void waitTransaction(client, "0x0", 0, Infinity);',
  );
  assert.deepEqual(messages, [
    "Transaction confirmation waits must have a finite timeout. Post-broadcast recovery remains a caller-owned runtime contract.",
  ]);
});

void test("allows finite transaction waits", async () => {
  const eslint = new ESLint();
  const messages = await restrictedSyntaxMessages(
    eslint,
    'void waitTransaction(client, "0x0", 0, 120_000);',
  );
  assert.deepEqual(messages, []);
});

async function restrictedSyntaxMessages(eslint: ESLint, call: string): Promise<string[]> {
  const [result] = await eslint.lintText(
    `declare const client: unknown;\ndeclare function waitTransaction(client: unknown, txHash: string, confirmations: number, timeout: number): Promise<void>;\n${call}`,
    { filePath },
  );
  return (result?.messages ?? [])
    .filter(({ ruleId }) => ruleId === "no-restricted-syntax")
    .map(({ message }) => message);
}
