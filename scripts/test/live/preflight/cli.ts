import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, usage } from "../../../live/preflight/args.ts";
import {
  isPublicChainIdentityError,
  publicErrorMessage,
} from "../../../live/preflight/errors.ts";
import { publicScript } from "../../../live/preflight/report.ts";

void test("preflight CLI selects the env prefix from the role argument", () => {
  assert.deepEqual(parseArgs([]), { prefix: "BOT" });
  assert.deepEqual(parseArgs(["--", "bot"]), { prefix: "BOT" });
  assert.deepEqual(parseArgs(["tester"]), { prefix: "TESTER" });
  assert.deepEqual(parseArgs(["--", "--help"]), { help: true });
  assert.deepEqual(parseArgs(["-h"]), { help: true });
  assert.throws(() => parseArgs(["bot", "tester"]), /Unknown argument: tester/u);
  assert.throws(() => parseArgs(["--config", "x"]), /Unknown argument: --config/u);
  assert.match(usage(), /\[bot\|tester\]/u);
});

void test("preflight CLI exposes public script shape only", () => {
  const scriptWithExtra = {
    codeHash: "0x11",
    hashType: "type",
    args: "0x22",
    extra: "ignored",
  };
  assert.deepEqual(publicScript(scriptWithExtra), {
    codeHash: "0x11",
    hashType: "type",
    args: "0x22",
  });
});

void test("preflight CLI keeps public error messages and classifies chain identity errors", () => {
  assert.equal(publicErrorMessage(new Error("public failure")), "public failure");
  assert.equal(publicErrorMessage(undefined), "Unknown error");
  assert.equal(
    isPublicChainIdentityError(
      new Error(
        "Invalid testnet RPC chain identity: genesis hash expected 0x1 observed 0x2",
      ),
    ),
    true,
  );
  assert.equal(
    isPublicChainIdentityError(new Error("Missing testnet genesis header")),
    true,
  );
  assert.equal(isPublicChainIdentityError(new Error("Invalid private key")), false);
});
