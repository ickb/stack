import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  firstSymlinkInPath,
  minimalProcessEnv,
  readLinuxProcessIdentity,
  runProcess,
  signalExitCode,
  timerDelayMs,
  type ProcessChild,
} from "../src/index.ts";

const { join } = path;
const HANG_SCRIPT = "setInterval(() => {}, 1000)";

describe("process runner", () => {
  it("captures only the configured stdout and stderr byte bounds", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write('abcdef'); process.stderr.write('uvwxyz')"],
      { maxOutputBytes: 3 },
    );

    expect(result).toMatchObject({
      status: 0,
      stdout: "abc\n<truncated output>",
      stderr: "uvw\n<truncated output>",
      stdoutTruncated: true,
      stderrTruncated: true,
      timedOut: false,
    });
    await expect(
      runProcess(process.execPath, ["-e", "process.stdout.write('x')"], {
        maxOutputBytes: 0,
        forwardSignals: false,
      }),
    ).resolves.toMatchObject({ stdout: "\n<truncated output>" });
  });
});

describe("process termination", () => {
  it("returns spawn failures and supports output-free commands", async () => {
    await expect(
      runProcess(
        "missing",
        [],
        {},
        {
          spawn: () => {
            throw new Error("spawn failed");
          },
        },
      ),
    ).resolves.toMatchObject({ status: null, error: new Error("spawn failed") });
    await expect(
      runProcess(process.execPath, ["-e", ""], { captureOutput: false }),
    ).resolves.toMatchObject({ status: 0, stdout: "", stderr: "" });
    await expect(
      runProcess("ickb-command-that-does-not-exist", []),
    ).resolves.toMatchObject({
      status: -2,
      error: { code: "ENOENT" },
    });
    await expect(
      runProcess(
        "ignored",
        [],
        {},
        {
          spawn: () => spawn(process.execPath, ["-e", ""], { stdio: "ignore" }),
        },
      ),
    ).rejects.toThrow("Expected spawned process stdout");
  });

  it("times out a process group and escalates to SIGKILL", async () => {
    const kills: NodeJS.Signals[] = [];
    const result = await runProcess(
      process.execPath,
      ["-e", `process.on('SIGTERM', () => {}); ${HANG_SCRIPT}`],
      { detached: true, timeoutMs: 100, killGraceMs: 10 },
      {
        killProcess: (pid, signal) => {
          kills.push(signal);
          process.kill(pid, signal);
        },
      },
    );

    expect(result).toMatchObject({ signal: "SIGKILL", timedOut: true });
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to direct child signaling when group signaling fails", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", HANG_SCRIPT],
      { detached: true, timeoutMs: 100 },
      {
        killProcess: () => {
          throw new Error("group unavailable");
        },
      },
    );

    expect(result).toMatchObject({ signal: "SIGTERM", timedOut: true });
    await expect(
      runProcess(process.execPath, ["-e", HANG_SCRIPT], {
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ signal: "SIGTERM", timedOut: true });
  });
});

describe("process group cleanup", () => {
  it("completes promptly when the timed-out leader leaves no process group", async () => {
    const startedAt = Date.now();
    const result = await runProcess(process.execPath, ["-e", HANG_SCRIPT], {
      detached: true,
      forwardSignals: false,
      timeoutMs: 100,
      killGraceMs: 2000,
    });

    expect(result).toMatchObject({ signal: "SIGTERM", timedOut: true });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("preserves scheduled escalation with injected group signaling", async () => {
    const kills: NodeJS.Signals[] = [];
    const result = await runProcess(
      process.execPath,
      ["-e", HANG_SCRIPT],
      { detached: true, forwardSignals: false, timeoutMs: 100, killGraceMs: 20 },
      {
        killProcess: (pid, signal) => {
          kills.push(signal);
          process.kill(pid, signal);
        },
      },
    );

    expect(result).toMatchObject({ signal: "SIGTERM", timedOut: true });
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("kills surviving descendants before completing after the leader exits", async () => {
    const descendantScript = `process.on('SIGTERM', () => {}); ${HANG_SCRIPT}`;
    const leaderScript = [
      "const { spawn } = require('node:child_process');",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
      "process.stdout.write(String(descendant.pid));",
      HANG_SCRIPT,
    ].join(" ");
    let descendantPid: number | undefined;

    try {
      const result = await runProcess(process.execPath, ["-e", leaderScript], {
        detached: true,
        forwardSignals: false,
        timeoutMs: 200,
        killGraceMs: 20,
      });
      descendantPid = Number(result.stdout);

      expect(result).toMatchObject({ signal: "SIGTERM", timedOut: true });
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      if (descendantPid !== undefined && processExists(descendantPid)) {
        process.kill(descendantPid, "SIGKILL");
      }
    }
  });
});

describe("process signal forwarding", () => {
  it("forwards SIGINT and reports its conventional exit status", async () => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const run = runProcess(
      process.execPath,
      ["-e", HANG_SCRIPT],
      { detached: true, killGraceMs: 100 },
      {
        addSignalHandler: (signal, handler) => handlers.set(signal, handler),
        removeSignalHandler: (signal, handler) => {
          if (handlers.get(signal) === handler) {
            handlers.delete(signal);
          }
        },
      },
    );
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    handlers.get("SIGINT")?.();
    handlers.get("SIGINT")?.();

    await expect(run).resolves.toMatchObject({
      signal: "SIGINT",
      forwardedSignal: "SIGINT",
    });
    expect(handlers.size).toBe(0);
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGTERM")).toBe(143);
  });

  it("escalates an ignored forwarded signal", async () => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const run = runProcess(
      process.execPath,
      ["-e", `process.on('SIGTERM', () => {}); ${HANG_SCRIPT}`],
      { detached: true, killGraceMs: 10 },
      {
        addSignalHandler: (signal, handler) => handlers.set(signal, handler),
        removeSignalHandler: (signal) => handlers.delete(signal),
      },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    handlers.get("SIGTERM")?.();

    await expect(run).resolves.toMatchObject({
      signal: "SIGKILL",
      forwardedSignal: "SIGTERM",
    });
  });
});

describe("process signal outcomes", () => {
  it("signals children started after cleanup has begun", async () => {
    const activeChildren = new Map<ProcessChild, boolean>();
    const result = await runProcess(process.execPath, ["-e", HANG_SCRIPT], {
      signalContext: { activeChildren, signal: "SIGTERM" },
    });

    expect(result).toMatchObject({
      signal: "SIGTERM",
      forwardedSignal: "SIGTERM",
    });
    expect(activeChildren.size).toBe(0);
  });

  it("provides a minimal child environment and bounded timer delay", () => {
    expect(minimalProcessEnv({ PATH: "/bin", PRIVATE_KEY: "secret" })).toEqual({
      PATH: "/bin",
    });
    expect(timerDelayMs(-1)).toBe(0);
    expect(timerDelayMs(Number.MAX_SAFE_INTEGER)).toBe(2_147_483_647);
  });
});

describe("Linux process identity", () => {
  it("parses start ticks after command names containing spaces and parentheses", async () => {
    const identity = await readLinuxProcessIdentity(42, async (filePath) => {
      await Promise.resolve();
      return filePath.endsWith("boot_id")
        ? "boot-1\n"
        : procStat({ command: "bot worker (live)", startTimeTicks: "987654" });
    });

    expect(identity).toEqual({ bootId: "boot-1", startTimeTicks: "987654" });
  });

  it("rejects malformed proc identity data", async () => {
    await expect(
      readLinuxProcessIdentity(42, async (filePath) => {
        await Promise.resolve();
        return filePath.endsWith("boot_id") ? "\n" : "malformed";
      }),
    ).rejects.toThrow("Linux boot ID is empty");
    await expect(readLinuxProcessIdentity(0)).rejects.toThrow("Invalid Linux process id");
  });

  it.each([
    ["PID mismatch", procStat({ pid: 43 }), "Malformed Linux proc stat"],
    [
      "malformed command boundary",
      procStat({ command: "bot worker" }).replace(" (bot worker) ", " bot worker "),
      "Malformed Linux proc stat",
    ],
    ["missing start ticks", procStat({ startTimeTicks: null }), "lacks start time"],
    ["zero start ticks", procStat({ startTimeTicks: "0" }), "lacks start time"],
  ])("rejects %s", async (_variant, stat, message) => {
    await expect(
      readLinuxProcessIdentity(42, async (filePath) => {
        await Promise.resolve();
        return filePath.endsWith("boot_id") ? "boot-1\n" : stat;
      }),
    ).rejects.toThrow(message);
  });
});

function procStat({
  command = "bot",
  pid = 42,
  startTimeTicks = "987654",
}: {
  command?: string;
  pid?: number;
  startTimeTicks?: string | null;
} = {}): string {
  const fieldsBeforeStart = Array.from({ length: 18 }, (_, index) => String(index + 1));
  const startFields = startTimeTicks === null ? "" : ` ${startTimeTicks} 20`;
  return `${String(pid)} (${command}) S ${fieldsBeforeStart.join(" ")}${startFields}\n`;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("symlink path traversal", () => {
  it("finds symlinks and accepts missing descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "ickb-node-path-"));
    try {
      const target = join(root, "target");
      const linked = join(root, "linked");
      await mkdir(target);
      await symlink(target, linked, "dir");

      await expect(firstSymlinkInPath(join(linked, "file"), root)).resolves.toBe(linked);
      await expect(
        firstSymlinkInPath(join(root, "missing", "file"), root),
      ).resolves.toBeUndefined();
      await expect(firstSymlinkInPath(target, root)).resolves.toBeUndefined();
      await expect(
        firstSymlinkInPath(target, root, {
          lstat: async () => {
            await Promise.resolve();
            throw new Error("stat failed");
          },
        }),
      ).rejects.toThrow("stat failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
