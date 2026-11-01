import { ccc } from "@ckb-ccc/core";
import { offlineTransport } from "@ickb/testkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sampleRows } = vi.hoisted(() => ({
  sampleRows: vi.fn<(client: ccc.Client) => AsyncGenerator<string>>(),
}));
vi.mock(import("../../src/sampler/sampler.ts"), () => ({ sampleRows }));

const client = ccc.ClientPublicMainnet.new({ transport: offlineTransport() });
const dispose = vi.fn<(value: ccc.ClientPublicMainnet) => void>();
const write = vi.fn<typeof process.stdout.write>(() => true);

// The entry point runs its whole job at import, so each test imports a fresh copy.
async function runEntry(): Promise<void> {
  vi.resetModules();
  await import("../../src/sampler.ts");
}

describe("sampler entry point", () => {
  beforeEach(() => {
    vi.spyOn(ccc.ClientPublicMainnet, "open").mockReturnValue(
      new ccc.OwnerUnique(client, dispose),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(write);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sampleRows.mockReset();
    dispose.mockReset();
    write.mockClear();
  });

  it("writes each row on its own line, then disposes the client", async () => {
    sampleRows.mockImplementation(async function* () {
      await Promise.resolve();
      yield "header";
      yield "row";
    });

    await runEntry();

    expect(sampleRows).toHaveBeenCalledWith(client);
    expect(write.mock.calls).toEqual([["header\n"], ["row\n"]]);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(client);
  });

  it("disposes the client when sampling fails", async () => {
    sampleRows.mockImplementation(async function* () {
      await Promise.resolve();
      yield "header";
      throw new Error("node down");
    });

    await expect(runEntry()).rejects.toThrow("node down");

    expect(write.mock.calls).toEqual([["header\n"]]);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(client);
  });
});
