import assert from "node:assert/strict";
import test from "node:test";
import { defaultCheckIgnored } from "../../../live/config/git.ts";

const ignoredConfigPath = "config/bot-testnet.json";

interface GitIgnoreCall {
  args: readonly string[];
  command: string;
  options: { encoding: "utf8"; env: Record<string, string> };
}

void test("git ignore helper checks a repo-relative path", () => {
  const calls: GitIgnoreCall[] = [];
  const ignored = defaultCheckIgnored(
    "/repo",
    ignoredConfigPath,
    (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  );

  assert.equal(ignored, true);
  const call = calls[0];
  assert(call !== undefined);
  assert.deepEqual(calls, [
    {
      command: "git",
      args: ["-C", "/repo", "check-ignore", "--", ignoredConfigPath],
      options: {
        encoding: "utf8",
        env: call.options.env,
      },
    },
  ]);
  assert.equal(call.options.env["PRIVATE_KEY"], undefined);
  assert.equal(call.options.env["NODE_OPTIONS"], undefined);
});

void test("git ignore helper treats status 1 as not ignored", () => {
  assert.equal(
    defaultCheckIgnored("/repo", "README.md", () => ({ status: 1 })),
    false,
  );
});

void test("git ignore helper reports missing git separately from not ignored", () => {
  const cause = new Error("spawn git ENOENT");

  assert.throws(
    () =>
      defaultCheckIgnored("/repo", ignoredConfigPath, () => ({
        status: null,
        error: cause,
      })),
    (error) => {
      assert(error instanceof Error);
      assert.equal(error.message, "Failed to run git check-ignore");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

void test("git ignore helper reports fatal git results", () => {
  assert.throws(
    () =>
      defaultCheckIgnored("/repo", ignoredConfigPath, () => ({
        status: 128,
        stderr: "fatal: not a git repository\n",
      })),
    /Failed to run git check-ignore: fatal: not a git repository/u,
  );
});
