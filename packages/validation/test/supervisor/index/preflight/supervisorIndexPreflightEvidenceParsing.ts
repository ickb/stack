import { describe, expect, it } from "vitest";
import {
  boundedText,
  parseJsonEvidence,
  parsePreflightEvidence,
} from "../../../../src/supervisor/index.ts";
import { MALFORMED_JSON_LINE } from "../../support/supervisor/index.ts";

describe("preflight evidence parsing", () => {
  it("keeps JSON records, discards banners, and flags malformed JSON", () => {
    const evidence = parseJsonEvidence(
      [
        "> package banner",
        JSON.stringify({ app: "bot", type: "bot.run.started" }),
        MALFORMED_JSON_LINE,
        "",
      ].join("\n"),
    );

    expect(evidence.records).toHaveLength(1);
    expect(evidence.ignoredLines).toEqual(["> package banner"]);
    expect(evidence.malformedLines).toEqual([MALFORMED_JSON_LINE]);
  });
});

describe("evidence parsing", () => {
  it("parses pretty preflight JSON as one report", () => {
    const evidence = parsePreflightEvidence(
      JSON.stringify({ chain: "testnet" }, null, 2),
    );

    expect(evidence.records).toEqual([{ chain: "testnet" }]);
    expect(evidence.malformedLines).toEqual([]);
  });

  it("bounds ASCII text including an accurate truncation marker", () => {
    const bounded = boundedText("abcdefghijklmnopqrstuvwxyz1234", 24);

    expect(bounded).toBe("abc\n<truncated 27 bytes>");
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(24);
  });

  it("does not split supplementary Unicode code points", () => {
    const bounded = boundedText(`A😀${"x".repeat(30)}`, 22);

    expect(bounded).toBe("A\n<truncated 34 bytes>");
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(22);
  });

  it("returns fitting text unchanged and empty output when no marker can fit", () => {
    expect(boundedText("ok", 2)).toBe("ok");
    expect(boundedText("x".repeat(30), 19)).toBe("");
    expect(boundedText("abc", 0)).toBe("");
  });
});
