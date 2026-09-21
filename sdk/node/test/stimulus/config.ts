import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStimulusConfig, readStimulusOverride } from "../../src/stimulus/config.ts";

const KEY_DIR = path.join(import.meta.dirname, "../../../.scratch/node-stimulus-config");
const KEY_FILE_PATH = path.join(KEY_DIR, "key");

afterEach(async () => {
  await rm(KEY_DIR, { recursive: true, force: true });
});

describe("readStimulusConfig", () => {
  it("accepts testnet and refuses mainnet before any signer exists", async () => {
    await mkdir(KEY_DIR, { recursive: true });
    await writeFile(KEY_FILE_PATH, `0x${"11".repeat(32)}\n`, { mode: 0o600 });
    const env = {
      STIMULUS_CHAIN: "testnet",
      STIMULUS_RPC_URL: "https://testnet.example/",
      STIMULUS_PRIVATE_KEY_FILE: KEY_FILE_PATH,
    };

    await expect(readStimulusConfig(env)).resolves.toMatchObject({ chain: "testnet" });
    await expect(
      readStimulusConfig({ ...env, STIMULUS_CHAIN: "mainnet" }),
    ).rejects.toThrow(
      "Invalid env STIMULUS_CHAIN: the stimulus generator runs on testnet only",
    );
  });
});

describe("readStimulusOverride", () => {
  it("leaves every draw random when no knob is set", () => {
    expect(readStimulusOverride({})).toEqual({});
  });

  it("pins each draw from its knob", () => {
    expect(
      readStimulusOverride({
        STIMULUS_KIND: "conversion",
        STIMULUS_DIRECTION: "ickb-to-ckb",
        STIMULUS_AMOUNT: "12.5",
        STIMULUS_FEE: "0",
      }),
    ).toEqual({
      kind: "conversion",
      direction: "ickb-to-ckb",
      amount: 1_250_000_000n,
      fee: 0n,
    });
    expect(readStimulusOverride({ STIMULUS_AMOUNT: "max" })).toEqual({ amount: "max" });
  });

  it("rejects values outside each knob's domain", () => {
    expect(() => readStimulusOverride({ STIMULUS_KIND: "orders" })).toThrow(
      "Invalid env STIMULUS_KIND: expected one of order, conversion",
    );
    expect(() => readStimulusOverride({ STIMULUS_DIRECTION: "mixed" })).toThrow(
      "Invalid env STIMULUS_DIRECTION",
    );
    for (const amount of ["0", "1e3", "-1", "1.123456789"]) {
      expect(() => readStimulusOverride({ STIMULUS_AMOUNT: amount })).toThrow(
        "Invalid env STIMULUS_AMOUNT",
      );
    }
    expect(() => readStimulusOverride({ STIMULUS_FEE: "1.5" })).toThrow(
      "Invalid env STIMULUS_FEE: expected an unsigned integer",
    );
    expect(() => readStimulusOverride({ STIMULUS_FEE: "100000" })).toThrow(
      "Invalid env STIMULUS_FEE: expected less than 100000",
    );
  });
});
