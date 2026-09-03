import {
  readLinuxProcessIdentity,
  type ProcessResult,
  type runProcess as runProcessCommand,
} from "@ickb/node-utils";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, it } from "vitest";

import {
  TEST_LAUNCH_IDENTITY,
  launcherStartedRecord,
  processIdentityFixture,
} from "../../support/stimulus/liveBotStimulus.ts";
import {
  LAUNCHER_STARTED_EVENT,
  proveLiveLauncher,
  runPreflight,
} from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import { asyncText, sessionPaths } from "./support.ts";

const { join } = path;
const CONFIG_JSON = "config.json";
const EVENTS_NDJSON = "events.ndjson";
it("surfaces preflight process and JSON failures", async () => {
  await expect(
    runPreflight("/repo", CONFIG_JSON, "bot", 1, {
      runProcess: preflightProcessRunner({ forwardedSignal: "SIGINT" }),
    }),
  ).rejects.toThrow("Process interrupted by SIGINT");
  await expect(
    runPreflight("/repo", CONFIG_JSON, "bot", 1, {
      runProcess: preflightProcessRunner({
        error: new Error("spawn failed"),
        status: null,
      }),
    }),
  ).rejects.toThrow("spawn failed");
  await expect(
    runPreflight("/repo", CONFIG_JSON, "bot", 1, {
      runProcess: preflightProcessRunner({ status: 2, stderr: "abcdef" }),
    }),
  ).rejects.toThrow("exited with status 2");
  await expect(
    runPreflight("/repo", CONFIG_JSON, "bot", 1, {
      runProcess: preflightProcessRunner({ stdout: "[]" }),
    }),
  ).rejects.toThrow("invalid JSON");
  await expect(
    runPreflight("/repo", CONFIG_JSON, "bot", 1, {
      runProcess: preflightProcessRunner({ stdout: "{" }),
    }),
  ).rejects.toThrow("invalid JSON");
});

it("runs the default preflight wrapper against a fixture script", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-preflight-"));
  const scriptsDir = join(tmpRoot, "scripts", "live");
  const preflightScriptPath = join(scriptsDir, "preflight.ts");

  await mkdir(scriptsDir, { recursive: true });

  await writeFile(
    preflightScriptPath,
    "console.log(JSON.stringify({ ok: true, args: process.argv.slice(2) }));\n",
  );

  await expect(
    runPreflight(tmpRoot, CONFIG_JSON, "tester", 3, {}),
  ).resolves.toMatchObject({
    ok: true,
    args: ["--config", CONFIG_JSON],
  });

  await writeFile(preflightScriptPath, "setTimeout(() => {}, 1000);\n");
  await expect(runPreflight(tmpRoot, CONFIG_JSON, "tester", 0.001, {})).rejects.toThrow(
    "preflight tester failed",
  );
});

function preflightProcessResult(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    status: 0,
    signal: null,
    stdout: "{}",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    ...overrides,
  };
}

function preflightProcessRunner(
  overrides: Partial<ProcessResult>,
): typeof runProcessCommand {
  return async () => {
    await Promise.resolve();
    return preflightProcessResult(overrides);
  };
}

it("requires a versioned launcher identity", async () => {
  const paths = sessionPaths("/repo");
  const launcherLine = JSON.stringify(
    launcherStartedRecord({ logFiles: { events: EVENTS_NDJSON } }),
  );

  await expect(
    proveLiveLauncher(paths, { readFile: asyncText("\nnot-json\n[]\n") }),
  ).rejects.toThrow("has no launcher.started record");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${launcherLine}\n${JSON.stringify({ type: "launcher.io.failed", pid: 3 })}\n`,
      ),
      readProcessIdentity: processIdentityFixture,
    }),
  ).resolves.toMatchObject({ pid: 100, childPid: 101 });
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${JSON.stringify({ type: LAUNCHER_STARTED_EVENT, pid: 100, childPid: 101 })}\n`,
      ),
    }),
  ).rejects.toThrow("legacy schema; restart the launcher");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${JSON.stringify({ ...launcherStartedRecord(), identity: {} })}\n`,
      ),
    }),
  ).rejects.toThrow("malformed process identity");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${JSON.stringify(launcherStartedRecord({ runId: "bad run id" }))}\n`,
      ),
    }),
  ).rejects.toThrow("lacks a valid runId");

  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(`${launcherLine}\n`),
      readProcessIdentity: processIdentityFixture,
    }),
  ).resolves.toMatchObject({
    pid: 100,
    childPid: 101,
    botEventsPath: join(paths.botLogDir, EVENTS_NDJSON),
  });
});

it.each([
  ["missing launcher PID", { pid: undefined }],
  ["zero launcher PID", { pid: 0 }],
  ["missing child PID", { childPid: undefined }],
  ["zero child PID", { childPid: 0 }],
])("rejects a launcher start record with %s", async (_variant, fields) => {
  const paths = sessionPaths("/repo");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(`${JSON.stringify(launcherStartedRecord(fields))}\n`),
    }),
  ).rejects.toThrow("live bot launcher start record lacks pid or childPid");
});

it("proves the current process through the default procfs identity reader", async () => {
  const paths = sessionPaths("/repo");
  const pid = process.pid;
  const current = await readLinuxProcessIdentity(pid);
  const processIdentity = { pid, startTimeTicks: current.startTimeTicks };
  const record = launcherStartedRecord({
    pid,
    childPid: pid,
    identity: {
      bootId: current.bootId,
      launcher: processIdentity,
      child: processIdentity,
    },
  });

  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(`${JSON.stringify(record)}\n`),
    }),
  ).resolves.toMatchObject({ pid, childPid: pid, identity: record["identity"] });
});

it("rejects launcher exit records and dead processes", async () => {
  const paths = sessionPaths("/repo");
  const launcherLine = JSON.stringify(launcherStartedRecord());
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${launcherLine}\n${JSON.stringify({ type: "launcher.child.exited", pid: 100 })}\n`,
      ),
      readProcessIdentity: processIdentityFixture,
    }),
  ).rejects.toThrow("already exited");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(
        `${launcherLine}\n${JSON.stringify({ type: "launcher.io.failed", pid: 100 })}\n`,
      ),
      readProcessIdentity: processIdentityFixture,
    }),
  ).rejects.toThrow("already exited");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(`${launcherLine}\n`),
      readProcessIdentity: async (pid) => {
        await Promise.resolve();
        if (pid === 100) {
          throw new Error("exited");
        }
        return processIdentityFixture(pid);
      },
    }),
  ).rejects.toThrow("launcher process is not running");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(`${launcherLine}\n`),
      readProcessIdentity: async (pid) => {
        await Promise.resolve();
        if (pid === 101) {
          throw new Error("exited");
        }
        return processIdentityFixture(pid);
      },
    }),
  ).rejects.toThrow("child process is not running");
});

it("rejects boot mismatch, PID reuse, and a changed launch identity", async () => {
  const paths = sessionPaths("/repo");
  const launcherLine = `${JSON.stringify(launcherStartedRecord())}\n`;
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(launcherLine),
      readProcessIdentity: async (pid) => ({
        ...(await processIdentityFixture(pid)),
        bootId: "next-boot",
      }),
    }),
  ).rejects.toThrow("boot identity does not match");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(launcherLine),
      readProcessIdentity: async (pid) => ({
        ...(await processIdentityFixture(pid)),
        startTimeTicks: pid === TEST_LAUNCH_IDENTITY.launcher.pid ? "9999" : "1010",
      }),
    }),
  ).rejects.toThrow("launcher process start time does not match");
  await expect(
    proveLiveLauncher(paths, {
      readFile: asyncText(launcherLine),
      readProcessIdentity: async (pid) => ({
        ...(await processIdentityFixture(pid)),
        startTimeTicks: pid === TEST_LAUNCH_IDENTITY.child.pid ? "9999" : "1000",
      }),
    }),
  ).rejects.toThrow("child process start time does not match");

  const initial = await proveLiveLauncher(paths, {
    readFile: asyncText(launcherLine),
    readProcessIdentity: processIdentityFixture,
  });
  await expect(
    proveLiveLauncher(
      paths,
      {
        readFile: asyncText(
          `${JSON.stringify(
            launcherStartedRecord({
              identity: {
                ...TEST_LAUNCH_IDENTITY,
                child: { pid: 101, startTimeTicks: "2020" },
              },
            }),
          )}\n`,
        ),
        readProcessIdentity: async (pid) => {
          await Promise.resolve();
          return {
            bootId: "test-boot",
            startTimeTicks: pid === 100 ? "1000" : "2020",
          };
        },
      },
      initial,
    ),
  ).rejects.toThrow("identity changed since initial proof");
});
