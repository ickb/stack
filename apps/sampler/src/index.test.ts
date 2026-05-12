import { describe, expect, it } from "vitest";
import { ccc } from "@ckb-ccc/core";
import { headerLike } from "@ickb/testkit";
import { main, samples } from "./index.js";

describe("sampler module", () => {
  it("can be imported without running the main loop", () => {
    expect(typeof main).toBe("function");
  });

  it("samples each covered UTC year", () => {
    expect(samples(0n, 1n, 1).map((date) => date.toISOString())).toEqual([
      "1970-01-01T00:00:00.000Z",
    ]);
  });

  it("logs sampled rows from an injected client", async () => {
    const genesis = sampleHeader(0n, "2024-09-12T00:00:00.000Z");
    const launch = sampleHeader(1n, "2024-09-12T15:13:19.574Z");
    const tip = sampleHeader(2n, "2024-09-13T00:00:00.000Z");
    const lines: string[] = [];

    await main({
      client: sampleClient(new Map([
        [0, genesis],
        [1, launch],
        [2, tip],
      ]), tip),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 1,
    });

    expect(lines.map((line) => line.split(", ").slice(0, 2))).toEqual([
      ["BlockNumber", "Date"],
      ["0", "2024-09-12T00:00:00.000Z"],
      ["1", "2024-09-12T15:13:19.574Z"],
      ["2", "2024-09-13T00:00:00.000Z"],
    ]);
    expect(lines.at(-2)?.endsWith(", iCKB Launch")).toBe(true);
    expect(lines.at(-1)?.endsWith(", Tip")).toBe(true);
  });

  it("uses a non-overflowing search bound for current chain heights", async () => {
    const genesis = sampleHeader(0n, "2024-09-12T00:00:00.000Z");
    const tip = sampleHeader(1_500_000_000n, "2024-09-13T00:00:00.000Z");
    const requests: bigint[] = [];

    await main({
      client: {
        getHeaderByNumber: async (blockNumber) => {
          requests.push(BigInt(blockNumber));
          await Promise.resolve();
          return BigInt(blockNumber) === 0n ? genesis : tip;
        },
        getTipHeader: async () => {
          await Promise.resolve();
          return tip;
        },
      },
      log: () => {},
      samplesPerYear: 1,
    });

    expect(requests.some((blockNumber) => blockNumber > 0n)).toBe(true);
  });

  it("throws when the selected sample header is missing", async () => {
    const genesis = sampleHeader(0n, "2024-09-12T00:00:00.000Z");
    const tip = sampleHeader(2n, "2024-09-13T00:00:00.000Z");

    await expect(main({
      client: sampleClient(new Map([
        [0, genesis],
        [2, tip],
      ]), tip),
      log: () => {},
      samplesPerYear: 1,
    })).rejects.toThrow("Header not found");
  });
});

function sampleHeader(number: bigint, isoTimestamp: string): ccc.ClientBlockHeader {
  return headerLike({
    number,
    timestamp: BigInt(Date.parse(isoTimestamp)),
  });
}

function sampleClient(
  headers: Map<number, ccc.ClientBlockHeader>,
  tip: ccc.ClientBlockHeader,
): Pick<ccc.Client, "getHeaderByNumber" | "getTipHeader"> {
  return {
    getHeaderByNumber: async (blockNumber): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return headers.get(Number(blockNumber));
    },
    getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return tip;
    },
  };
}
