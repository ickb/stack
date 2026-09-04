import { ccc } from "@ckb-ccc/core";
import { headerLike, StubClient } from "@ickb/testkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSamplerClient, main, samples } from "../src/sampler.ts";

const SAMPLER_MODULE_SUITE = "sampler module";
const SAMPLE_GENESIS_ISO = "2024-09-12T00:00:00.000Z";
const SAMPLE_LAUNCH_ISO = "2024-09-12T15:13:19.574Z";
const SAMPLE_TIP_ISO = "2024-09-13T00:00:00.000Z";
const APPROXIMATE_SAMPLE = "Approximate timestamp sample";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("samples each covered UTC year", () => {
    expect(samples(0n, 1n, 1).map((date) => date.toISOString())).toEqual([
      "1970-01-01T00:00:00.000Z",
    ]);
  });

  it("rejects reversed sample ranges", () => {
    expect(() => samples(2n, 1n, 1)).toThrow("endMs must be bigger than startMs");
  });

  it.each([
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["zero", 0],
    ["negative", -1],
  ])("rejects a %s sample count", (_label, count) => {
    expect(() => samples(1n, 2n, count)).toThrow("n must be a positive safe integer");
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("defaults to stdout logging", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const tip = sampleHeader(1n, SAMPLE_TIP_ISO);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await main({
      client: sampleClient(
        new Map([
          [0, genesis],
          [1, tip],
        ]),
        tip,
      ),
      samplesPerYear: 1,
    });

    expect(write).toHaveBeenCalledWith("BlockNumber, Date, CkbPerIckb, Note\n");
  });

  it("constructs a mainnet public client by default", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const tip = sampleHeader(1n, SAMPLE_TIP_ISO);
    const client = sampleClient(
      new Map([
        [0, genesis],
        [1, tip],
      ]),
      tip,
    );
    const createClient = vi.fn((): ccc.Client => client);

    await main({ createClient, log: noopLog, samplesPerYear: 1 });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith();
    const samplerClient = createSamplerClient();
    expect(samplerClient).toBeInstanceOf(ccc.ClientPublicMainnet);
    expect(samplerClient.url).toBe("https://mainnet.ckb.dev/");
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("throws when the genesis header is missing", async () => {
    await expect(
      main({
        client: sampleClient(new Map(), sampleHeader(1n, SAMPLE_TIP_ISO)),
        log: noopLog,
        samplesPerYear: 1,
      }),
    ).rejects.toThrow("Genesis block not found");
  });

  it("logs sampled rows from an injected client", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const launch = sampleHeader(1n, SAMPLE_LAUNCH_ISO);
    const tip = sampleHeader(2n, SAMPLE_TIP_ISO);
    const lines: string[] = [];

    await main({
      client: sampleClient(
        new Map([
          [0, genesis],
          [1, launch],
          [2, tip],
        ]),
        tip,
      ),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 1,
    });

    expect(lines.map((line) => line.split(", ").slice(0, 2))).toEqual([
      ["BlockNumber", "Date"],
      ["0", SAMPLE_GENESIS_ISO],
      ["1", SAMPLE_LAUNCH_ISO],
      ["2", SAMPLE_TIP_ISO],
    ]);
    expect(lines.at(-2)?.endsWith(", Approximate iCKB Launch")).toBe(true);
    expect(lines.at(-1)?.endsWith(", Tip")).toBe(true);
    expect(lines[1]?.split(", ", 4)[2]).toBe("1.00082");
  });

  it("keeps one target when default sample count is omitted", async () => {
    const genesisIso = "2024-01-01T00:00:00.000Z";
    const tipIso = "2024-03-01T00:00:00.000Z";
    const genesis = sampleHeader(0n, genesisIso);
    const tip = sampleHeader(1n, tipIso);
    const lines: string[] = [];

    await main({
      client: sampleClient(
        new Map([
          [0, genesis],
          [1, tip],
        ]),
        tip,
      ),
      log: (line) => {
        lines.push(line);
      },
    });

    expect(lines).toHaveLength(4);
    expect(lines[2]?.startsWith(`0, ${genesisIso}`)).toBe(true);
    expect(lines[2]?.endsWith(", Approximate timestamp sample")).toBe(true);
    expect(lines.at(-1)?.endsWith(", Tip")).toBe(true);
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("reuses each probed header for stable selection", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const launch = sampleHeader(1n, SAMPLE_LAUNCH_ISO);
    const tip = sampleHeader(2n, SAMPLE_TIP_ISO);
    const headers = new Map([
      [0, genesis],
      [1, launch],
      [2, tip],
    ]);
    const reads = new Map<number, number>();
    const inconsistent = sampleHeader(99n, "2024-09-14T00:00:00.000Z");
    const lines: string[] = [];

    await main({
      client: new StubClient({
        getHeaderByNumber: async (
          blockNumber,
        ): Promise<ccc.ClientBlockHeader | undefined> => {
          const number = Number(blockNumber);
          const count = (reads.get(number) ?? 0) + 1;
          reads.set(number, count);
          await Promise.resolve();
          return count === 1 ? headers.get(number) : inconsistent;
        },
        getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
          await Promise.resolve();
          return tip;
        },
      }),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 1,
    });

    expect(Object.fromEntries(reads)).toEqual({ 0: 1, 1: 1, 2: 1 });
    expect(lines.map((line) => line.split(", ").slice(0, 2))).toEqual([
      ["BlockNumber", "Date"],
      ["0", SAMPLE_GENESIS_ISO],
      ["1", SAMPLE_LAUNCH_ISO],
      ["2", SAMPLE_TIP_ISO],
    ]);
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("does not sample iCKB launch after the current tip", async () => {
    const genesis = sampleHeader(0n, "2024-09-11T00:00:00.000Z");
    const tip = sampleHeader(1n, "2024-09-12T00:00:00.000Z");
    const lines: string[] = [];

    await main({
      client: sampleClient(
        new Map([
          [0, genesis],
          [1, tip],
        ]),
        tip,
      ),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 1,
    });

    expect(lines.join("\n")).not.toContain("iCKB Launch");
    expect(lines.at(-1)?.endsWith(", Tip")).toBe(true);
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("orders the iCKB launch sample among the yearly samples", async () => {
    const headers = new Map(
      [
        "2024-01-01T00:00:00.000Z",
        "2024-04-01T00:00:00.000Z",
        "2024-07-02T00:00:00.000Z",
        SAMPLE_LAUNCH_ISO,
        "2024-10-01T00:00:00.000Z",
        "2024-12-31T00:00:00.000Z",
      ].map((iso, index): [number, ccc.ClientBlockHeader] => [
        index,
        sampleHeader(BigInt(index), iso),
      ]),
    );
    const tip = headers.get(5);
    const lines: string[] = [];

    await main({
      client: sampleClient(headers, tip ?? sampleHeader(5n, SAMPLE_TIP_ISO)),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 4,
    });

    expect(lines.slice(1).map((line) => line.split(", ", 4)[3])).toEqual([
      "Genesis",
      APPROXIMATE_SAMPLE,
      APPROXIMATE_SAMPLE,
      APPROXIMATE_SAMPLE,
      "Approximate iCKB Launch",
      APPROXIMATE_SAMPLE,
      "Tip",
    ]);
  });

  it("logs the exact tip header without searching for it", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const launch = sampleHeader(1n, SAMPLE_LAUNCH_ISO);
    const tip = sampleHeader(2n, SAMPLE_TIP_ISO);
    const lines: string[] = [];

    await main({
      // The tip block is unreachable by number, so only the fetched tip header
      // can produce an exact tip row.
      client: sampleClient(
        new Map([
          [0, genesis],
          [1, launch],
        ]),
        tip,
      ),
      log: (line) => {
        lines.push(line);
      },
      samplesPerYear: 1,
    });

    expect(lines.at(-1)?.startsWith(`2, ${SAMPLE_TIP_ISO}`)).toBe(true);
    expect(lines.at(-1)?.endsWith(", Tip")).toBe(true);
  });

  it("uses a non-overflowing search bound for current chain heights", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const tip = sampleHeader(1_500_000_000n, SAMPLE_TIP_ISO);
    const requests: bigint[] = [];

    await main({
      client: new StubClient({
        getHeaderByNumber: async (
          blockNumber,
        ): ReturnType<ccc.Client["getHeaderByNumber"]> => {
          requests.push(ccc.numFrom(blockNumber));
          await Promise.resolve();
          return ccc.numFrom(blockNumber) === 0n ? genesis : tip;
        },
        getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
          await Promise.resolve();
          return tip;
        },
      }),
      log: noopLog,
      samplesPerYear: 1,
    });

    const positiveRequest = requests.find((blockNumber) => blockNumber > 0n);
    expect(positiveRequest).toBeGreaterThan(0n);
  });
});

describe(SAMPLER_MODULE_SUITE, () => {
  it("rejects tip heights beyond the number-safe search range", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const tip = sampleHeader(2n ** 52n, SAMPLE_TIP_ISO);

    await expect(
      main({
        client: sampleClient(new Map([[0, genesis]]), tip),
        log: noopLog,
        samplesPerYear: 1,
      }),
    ).rejects.toThrow("Tip block number exceeds sampler search range");
  });

  it("throws when the selected sample header is missing", async () => {
    const genesis = sampleHeader(0n, SAMPLE_GENESIS_ISO);
    const tip = sampleHeader(2n, SAMPLE_TIP_ISO);

    await expect(
      main({
        client: sampleClient(
          new Map([
            [0, genesis],
            [2, tip],
          ]),
          tip,
        ),
        log: noopLog,
        samplesPerYear: 1,
      }),
    ).rejects.toThrow("Header not found");
  });
});

function sampleHeader(number: bigint, isoTimestamp: string): ccc.ClientBlockHeader {
  return headerLike({
    number,
    timestamp: BigInt(Date.parse(isoTimestamp)),
    dao: { ar: 10000000000000000n, c: 0n, s: 0n, u: 0n },
  });
}

function noopLog(): void {
  // Intentionally empty test logger.
}

function sampleClient(
  headers: Map<number, ccc.ClientBlockHeader>,
  tip: ccc.ClientBlockHeader,
): ccc.Client {
  return new StubClient({
    getHeaderByNumber: async (
      blockNumber,
    ): Promise<ccc.ClientBlockHeader | undefined> => {
      await Promise.resolve();
      return headers.get(Number(blockNumber));
    },
    getTipHeader: async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return tip;
    },
  });
}
