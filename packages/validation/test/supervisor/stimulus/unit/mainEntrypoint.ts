import { ProcessSignalError } from "@ickb/node-utils";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

import { testArgs, textWriter } from "../../support/stimulus/liveBotStimulus.ts";
import { runLiveBotStimulusMain } from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import {
  eventFileCursor,
  runLiveBotStimulusTest,
} from "../../support/stimulus/liveBotStimulusSessionImports.ts";
import {
  asyncNoop,
  errno,
  liveStimulusDependencies,
  mapWrite,
  sessionPaths,
} from "./support.ts";

const { join } = path;
const EVENTS_NDJSON = "events.ndjson";
const LAUNCHER_MISSING = "launcher missing";
const KEEP_GOING_FLAG = "--keep-going";
it("writes a best-effort summary and rethrows session preparation failures", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-session-fail-"));
  const paths = sessionPaths(tmpRoot);
  const writes = new Map<string, string>();

  await expect(
    runLiveBotStimulusTest({
      root: tmpRoot,
      args: testArgs({ logRoot: tmpRoot, sessionRoot: paths.sessionRoot }),
      dependencies: {
        runSupervisor: async () => {
          await Promise.resolve();
          return 0;
        },
        mkdir,
        lstat: async () => {
          await Promise.resolve();
          throw errno("missing", "ENOENT");
        },
        realpath: async (targetPath) => {
          await Promise.resolve();
          return targetPath;
        },
        writeFile: mapWrite(writes),
        appendFile: asyncNoop,
        readFile: async () => {
          await Promise.resolve();
          throw new Error(LAUNCHER_MISSING);
        },
      },
    }),
  ).rejects.toThrow(LAUNCHER_MISSING);
  expect(writes.get(paths.summaryPath)).toContain(LAUNCHER_MISSING);
});

it("reports live stimulus main parse, help, and runtime failures", async () => {
  const stdout = textWriter();
  const stderr = textWriter();

  await expect(
    runLiveBotStimulusMain(["--bad"], liveStimulusDependencies(), { stdout, stderr }),
  ).resolves.toBe(1);
  expect(stderr.text).toContain("Unknown argument");

  await expect(
    runLiveBotStimulusMain(["--help"], liveStimulusDependencies(), {
      stdout,
      stderr,
    }),
  ).resolves.toBe(0);
  expect(stdout.text).toContain("Usage:");

  stderr.text = "";
  await expect(
    runLiveBotStimulusMain(
      ["--session-root", "outside/validation/run"],
      liveStimulusDependencies(),
      {
        stdout,
        stderr,
      },
    ),
  ).resolves.toBe(1);
  expect(stderr.text).toContain("Live bot stimulus test failed");
});

it("uses process stdout when no live stimulus io stream is supplied", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    await expect(
      runLiveBotStimulusMain(["--help"], liveStimulusDependencies()),
    ).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  } finally {
    write.mockRestore();
  }
});

it.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)("preserves %s as exit code %i", async (signal, exitCode) => {
  const dependencies = liveStimulusDependencies();
  dependencies.lstat = async (): Promise<never> => {
    await Promise.resolve();
    throw new ProcessSignalError(signal);
  };

  await expect(runLiveBotStimulusMain([], dependencies)).resolves.toBe(exitCode);
});

it("runs the default one-shot command exactly once", async () => {
  const runSession = vi.fn(async (): Promise<number> => {
    await Promise.resolve();
    return 0;
  });

  await expect(
    runLiveBotStimulusMain(
      [],
      liveStimulusDependencies(),
      { stdout: textWriter(), stderr: textWriter() },
      runSession,
    ),
  ).resolves.toBe(0);
  expect(runSession).toHaveBeenCalledTimes(1);
});

it.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)(
  "runs keep-going sessions serially with distinct roots until %s",
  async (signal, exitCode) => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const roots: string[] = [];
    let active = 0;
    let maxActive = 0;
    const runSession = vi.fn(
      async ({ args }: Parameters<typeof runLiveBotStimulusTest>[0]): Promise<number> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        roots.push(args.sessionRoot ?? "");
        await Promise.resolve();
        if (roots.length === 2) {
          handlers.get(signal)?.();
        }
        active -= 1;
        return 0;
      },
    );
    const dependencies = {
      ...liveStimulusDependencies(),
      now: (): number => 1_700_000_000_000,
      addSignalHandler: (name: NodeJS.Signals, handler: () => void): void => {
        handlers.set(name, handler);
      },
      removeSignalHandler: (name: NodeJS.Signals, handler: () => void): void => {
        if (handlers.get(name) === handler) {
          handlers.delete(name);
        }
      },
    };

    await expect(
      runLiveBotStimulusMain(
        [KEEP_GOING_FLAG, "--log-root", "log"],
        dependencies,
        { stdout: textWriter(), stderr: textWriter() },
        runSession,
      ),
    ).resolves.toBe(exitCode);

    expect(maxActive).toBe(1);
    expect(runSession).toHaveBeenCalledTimes(2);
    expect(new Set(roots).size).toBe(2);
    expect(roots[0]).toContain("cycle-0001");
    expect(roots[1]).toContain("cycle-0002");
    expect(handlers.size).toBe(0);
  },
);

it("stops keep-going after the first failed cycle", async () => {
  const runSession = vi.fn(async (): Promise<number> => {
    await Promise.resolve();
    return 2;
  });

  await expect(
    runLiveBotStimulusMain(
      [KEEP_GOING_FLAG],
      liveStimulusDependencies(),
      { stdout: textWriter(), stderr: textWriter() },
      runSession,
    ),
  ).resolves.toBe(2);
  expect(runSession).toHaveBeenCalledTimes(1);
});

it("preserves a signal received during a terminal keep-going session", async () => {
  const handlers = new Map<NodeJS.Signals, () => void>();
  const runSession = vi.fn(async (): Promise<number> => {
    handlers.get("SIGTERM")?.();
    await Promise.resolve();
    return 2;
  });

  await expect(
    runLiveBotStimulusMain(
      [KEEP_GOING_FLAG],
      {
        ...liveStimulusDependencies(),
        addSignalHandler: (signal, handler): void => {
          handlers.set(signal, handler);
        },
        removeSignalHandler: (signal): void => {
          handlers.delete(signal);
        },
      },
      { stdout: textWriter(), stderr: textWriter() },
      runSession,
    ),
  ).resolves.toBe(143);
  expect(runSession).toHaveBeenCalledTimes(1);
  expect(handlers.size).toBe(0);
});

it("executes the live stimulus test entrypoint guard", async () => {
  const originalArgv = process.argv;
  const moduleUrl = new URL(
    "../../../../../../apps/validation/src/liveBotStimulusTest.ts",
    import.meta.url,
  );
  const modulePath = fileURLToPath(moduleUrl);
  try {
    vi.resetModules();
    process.argv = [process.execPath, modulePath, "--help"];
    await import(`${moduleUrl.href}?entry-help`);
    expect(process.exitCode).toBe(0);

    vi.resetModules();
    process.argv = [process.execPath];
    await import(`${moduleUrl.href}?entry-no-argv`);
  } finally {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.resetModules();
  }
});

it("reads event file offsets through the default stat dependency", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-offset-"));
  const filePath = join(tmpRoot, EVENTS_NDJSON);

  await writeFile(filePath, "abc");

  await expect(eventFileCursor(filePath, {})).resolves.toMatchObject({ offset: 3 });
});
