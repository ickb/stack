import assert from "node:assert/strict";
import test from "node:test";
import { defaultCheckIgnored } from "./ickb-live-config-git.mjs";

test("git ignore helper checks a repo-relative path", () => {
  const calls = [];
  const ignored = defaultCheckIgnored("/repo", "config/bot-testnet.json", (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  });

  assert.equal(ignored, true);
  assert.deepEqual(calls, [
    {
      command: "git",
      args: ["-C", "/repo", "check-ignore", "--", "config/bot-testnet.json"],
      options: { encoding: "utf8" },
    },
  ]);
});

test("git ignore helper treats status 1 as not ignored", () => {
  assert.equal(defaultCheckIgnored("/repo", "README.md", () => ({ status: 1 })), false);
});

test("git ignore helper reports missing git separately from not ignored", () => {
  const cause = new Error("spawn git ENOENT");

  assert.throws(
    () => defaultCheckIgnored("/repo", "config/bot-testnet.json", () => ({ status: null, error: cause })),
    (error) => {
      assert(error instanceof Error);
      assert.equal(error.message, "Failed to run git check-ignore");
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test("git ignore helper reports fatal git results", () => {
  assert.throws(
    () => defaultCheckIgnored("/repo", "config/bot-testnet.json", () => ({
      status: 128,
      stderr: "fatal: not a git repository\n",
    })),
    /Failed to run git check-ignore: fatal: not a git repository/u,
  );
});
