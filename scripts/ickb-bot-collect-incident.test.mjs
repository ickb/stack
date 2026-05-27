import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectIncident, parseArgs, parseTimeBound } from "./ickb-bot-collect-incident.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const collector = join(rootDir, "scripts", "ickb-bot-collect-incident.mjs");
const canaryPrivateKey = `0x${"42".repeat(32)}`;

test("parses collector arguments and relative time bounds", () => {
  assert.deepEqual(parseArgs([
    "--log-root",
    "var/logs",
    "--network",
    "testnet",
    "--since",
    "2h",
    "--until",
    "now",
    "--no-systemd",
  ]), {
    includeSystemd: false,
    logRoot: "var/logs",
    network: "testnet",
    since: "2h",
    until: "now",
  });

  const now = new Date("2026-05-25T12:00:00.000Z");
  assert.equal(parseTimeBound("now", now).toISOString(), "2026-05-25T12:00:00.000Z");
  assert.equal(parseTimeBound("2h", now).toISOString(), "2026-05-25T10:00:00.000Z");
  assert.equal(parseTimeBound("2026-05-25T11:00:00Z", now).toISOString(), "2026-05-25T11:00:00.000Z");
  assert.throws(() => parseArgs(["--network", "devnet", "--since", "now", "--until", "now"]), /Invalid network/u);
  assert.throws(() => parseArgs(["--network", "testnet", "--log-dir", "log/bot/testnet", "--since", "now", "--until", "now"]), /exactly one/u);
  assert.throws(() => parseArgs(["--network", "testnet", "--until", "now"]), /Missing required --since/u);
});

test("collects a time-bounded source-separated incident bundle with summary counts", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: [
        botEvent("2026-05-25T09:59:59.000Z", "bot.transaction.sent", { outcome: "broadcasted", txHash: txHash("01") }),
        botEvent("2026-05-25T10:00:00.000Z", "bot.run.started", { bounded: true }),
        "not-json\n",
        JSON.stringify({ app: "execution", timestamp: "2026-05-25T10:05:00.000Z", message: "non-bot stdout" }) + "\n",
        botEvent("2026-05-25T10:10:00.000Z", "bot.decision.skipped", { reason: "no_actions" }),
        botEvent("2026-05-25T10:20:00.000Z", "bot.transaction.sent", { outcome: "broadcasted", txHash: txHash("02") }),
        botEvent("2026-05-25T10:21:00.000Z", "bot.transaction.failed", { outcome: "timeout_after_broadcast", txHash: txHash("02") }),
        botEvent("2026-05-25T11:00:00.000Z", "bot.iteration.failed", { error: { message: "fetch failed" }, retryable: true, terminal: false }),
        botEvent("2026-05-25T10:59:59.500Z", "bot.iteration.failed", {
          error: { message: "fetch failed" },
          retryable: true,
          terminal: true,
          retryableAttempts: 3,
          maxRetryableAttempts: 3,
          retryBudgetExhausted: true,
        }),
        botEvent("2026-05-25T11:00:01.000Z", "bot.transaction.committed", { outcome: "committed", txHash: txHash("03") }),
      ],
      launches: [
        launch("2026-05-25T09:00:00.000Z", "launcher.started", { status: null }),
        launch("2026-05-25T10:00:00.000Z", "launcher.started", { status: null }),
        launch("2026-05-25T10:30:00.000Z", "launcher.child.exited", { status: 2 }),
        "{bad-json\n",
        launch("2026-05-25T11:00:01.000Z", "launcher.child.exited", { status: 0 }),
      ],
      stderr: [
        "2026-05-25T09:00:00.000Z before window\n",
        "2026-05-25T10:15:00.000Z runtime warning\n",
        "    at worker (bot.js:10:1)\n",
        "undated warning\n",
        "2026-05-25T11:00:01.000Z after window\n",
        "outside continuation\n",
      ],
    });

    const result = await collectIncident({
      argv: [
        "--log-root",
        dir,
        "--network",
        "testnet",
        "--since",
        "2026-05-25T10:00:00.000Z",
        "--until",
        "2026-05-25T11:00:00.000Z",
        "--no-systemd",
      ],
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    assert.match(result.incidentDir, /\/incidents\/20260525T120000000Z-testnet-/u);
    assert.equal(await mode(result.incidentDir), 0o700);
    assert.equal(await mode(join(result.incidentDir, "summary.json")), 0o600);
    assert.equal(await readFile(join(result.incidentDir, "bot.stderr.log"), "utf8"), [
      "2026-05-25T10:15:00.000Z runtime warning\n",
      "    at worker (bot.js:10:1)\n",
      "undated warning\n",
    ].join(""));

    const eventBundle = await readFile(join(result.incidentDir, "bot.events.ndjson"), "utf8");
    assert.match(eventBundle, /bot\.run\.started/u);
    assert.match(eventBundle, /non-bot stdout/u);
    assert.doesNotMatch(eventBundle, /09:59:59|11:00:01|not-json/u);

    const summary = JSON.parse(await readFile(join(result.incidentDir, "summary.json"), "utf8"));
    assert.equal(summary.logDir, logDir);
    assert.deepEqual(summary.botEvents.countsByType, {
      "bot.decision.skipped": 1,
      "bot.iteration.failed": 2,
      "bot.run.started": 1,
      "bot.transaction.failed": 1,
      "bot.transaction.sent": 1,
    });
    assert.deepEqual(summary.botEvents.txHashesByOutcome, {
      broadcasted: [txHash("02")],
      timeout_after_broadcast: [txHash("02")],
    });
    assert.deepEqual(summary.botEvents.skipReasons, { no_actions: 1 });
    assert.deepEqual(summary.botEvents.failureReasons, { "fetch failed": 1, retry_budget_exhausted: 1, timeout_after_broadcast: 1 });
    assert.deepEqual(summary.launches.exitCodes, { 2: 1 });
    assert.equal(summary.sources["bot.events.ndjson"].malformedLines, 1);
    assert.equal(summary.sources["bot.events.ndjson"].selectedLines, 7);
    assert.equal(summary.sources["bot.stderr.log"].undatedLines, 3);
    assert.equal(summary.sources["bot.stderr.log"].selectedUndatedLines, 2);
    assert.equal(summary.systemd.included, false);
    assert.match(summary.compression.command, /tar -czf/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("includes a bounded tail when stderr has no timestamps", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: Array.from({ length: 205 }, (_, index) => `stack line ${index.toString()}\n`),
    });

    const result = await collectIncident({
      argv: commonArgs(dir),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    const stderr = await readFile(join(result.incidentDir, "bot.stderr.log"), "utf8");
    assert.doesNotMatch(stderr, /^stack line 0$/mu);
    assert.match(stderr, /^stack line 5$/mu);
    assert.match(stderr, /^stack line 204$/mu);

    const summary = JSON.parse(await readFile(join(result.incidentDir, "summary.json"), "utf8"));
    assert.equal(summary.sources["bot.stderr.log"].selectedLines, 200);
    assert.equal(summary.sources["bot.stderr.log"].selectedUndatedLines, 200);
    assert.equal(summary.sources["bot.stderr.log"].undatedLines, 205);
    assert.equal(summary.sources["bot.stderr.log"].undatedTailIncluded, true);
    assert.equal(summary.sources["bot.stderr.log"].undatedTailLimit, 200);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("decodes source log UTF-8 across chunk boundaries", async () => {
  const dir = await tempDir();
  try {
    const marker = "snowman ☃";
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started", { marker })],
      launches: [],
      stderr: [],
    });
    const eventPath = join(logDir, "bot.events.ndjson");
    const bytes = Buffer.from(await readFile(eventPath, "utf8"));
    const splitAt = bytes.indexOf(Buffer.from("☃")) + 1;

    const result = await collectIncident({
      argv: commonArgs(dir),
      dependencies: {
        open(path, flags, mode) {
          if (path === eventPath && typeof flags === "number") {
            return splitReadHandle(path, [bytes.subarray(0, splitAt), bytes.subarray(splitAt)]);
          }
          return open(path, flags, mode);
        },
      },
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    const events = await readFile(join(result.incidentDir, "bot.events.ndjson"), "utf8");
    assert.match(events, new RegExp(marker, "u"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("does not use undated stderr tail fallback when timestamped stderr is outside the window", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: [
        "2026-05-25T09:00:00.000Z before window\n",
        "outside continuation\n",
      ],
    });

    const result = await collectIncident({
      argv: commonArgs(dir),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    assert.equal(await readFile(join(result.incidentDir, "bot.stderr.log"), "utf8"), "");
    const summary = JSON.parse(await readFile(join(result.incidentDir, "summary.json"), "utf8"));
    assert.equal(summary.sources["bot.stderr.log"].timestampedLines, 1);
    assert.equal(summary.sources["bot.stderr.log"].undatedLines, 1);
    assert.equal(summary.sources["bot.stderr.log"].selectedLines, 0);
    assert.equal(summary.sources["bot.stderr.log"].undatedTailIncluded, false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("accepts explicit contained log directory and environment log root", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [launch("2026-05-25T10:00:01.000Z", "launcher.child.exited", { status: 0 })],
      stderr: ["2026-05-25T10:00:02.000Z ok\n"],
    });

    const result = await collectIncident({
      argv: [
        "--log-dir",
        logDir,
        "--since",
        "2026-05-25T10:00:00.000Z",
        "--until",
        "2026-05-25T10:00:02.000Z",
        "--no-systemd",
      ],
      envLogRoot: dir,
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });
    const summary = JSON.parse(await readFile(join(result.incidentDir, "summary.json"), "utf8"));
    assert.equal(summary.logRoot, dir);
    assert.equal(summary.logRootSource, "env:ICKB_BOT_LOG_ROOT");
    assert.equal(summary.logDir, logDir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses log directories outside the resolved log root", async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(() => collectIncident({
      argv: [
        "--log-root",
        join(dir, "root"),
        "--log-dir",
        join(dir, "outside"),
        "--since",
        "2026-05-25T10:00:00.000Z",
        "--until",
        "2026-05-25T11:00:00.000Z",
        "--no-systemd",
      ],
      root: rootDir,
    }), /inside the resolved log root/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses symlinked log roots and log directories", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: [],
    });
    const linkedRoot = join(dir, "linked-root");
    await symlink(dir, linkedRoot, "dir");
    await assert.rejects(() => collectIncident({
      argv: commonArgs(linkedRoot),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    }), /symlinked log root path/u);

    const linkedLogDir = join(dir, "linked-log-dir");
    await symlink(join(dir, "bot", "testnet"), linkedLogDir, "dir");
    await assert.rejects(() => collectIncident({
      argv: [
        "--log-root",
        dir,
        "--log-dir",
        linkedLogDir,
        "--since",
        "2026-05-25T10:00:00.000Z",
        "--until",
        "2026-05-25T11:00:00.000Z",
        "--no-systemd",
      ],
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    }), /symlinked log directory path/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses symlinked source logs and incident directory parents", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: [],
    });
    await rm(join(logDir, "bot.events.ndjson"));
    await writeFile(join(dir, "target-events"), botEvent("2026-05-25T10:00:00.000Z", "bot.run.started"));
    await symlink(join(dir, "target-events"), join(logDir, "bot.events.ndjson"));

    await assert.rejects(() => collectIncident({
      argv: commonArgs(dir),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    }), /symlinked source log file/u);

    await rm(join(logDir, "bot.events.ndjson"));
    await writeFile(join(logDir, "bot.events.ndjson"), botEvent("2026-05-25T10:00:00.000Z", "bot.run.started"));
    await symlink(join(dir, "target-incidents"), join(logDir, "incidents"), "dir");

    await assert.rejects(() => collectIncident({
      argv: commonArgs(dir),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    }), /symlinked incident directory parent/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("includes selected producer log text without masking bundles", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [
        botEvent("2026-05-25T10:00:00.000Z", "bot.run.started", {
          error: "public diagnostic",
        }),
      ],
      launches: [],
      stderr: [],
    });

    const result = await collectIncident({
      argv: commonArgs(dir),
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });
    const events = await readFile(join(result.incidentDir, "bot.events.ndjson"), "utf8");
    assert.match(events, /public diagnostic/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("produced bundles do not contain configured canary secrets", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [launch("2026-05-25T10:00:00.000Z", "launcher.started")],
      stderr: ["2026-05-25T10:00:00.000Z public diagnostic\n"],
    });

    const result = spawnSync(process.execPath, [collector, ...commonArgs(dir)], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ICKB_TESTNET_BOT_PRIVATE_KEY: canaryPrivateKey,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(canaryPrivateKey, "u"));
    const incidentDir = /^Incident bundle directory: (.+)$/mu.exec(result.stdout)?.[1];
    assert.ok(incidentDir);

    const produced = [
      "bot.events.ndjson",
      "bot.stderr.log",
      "launches.ndjson",
      "README.txt",
      "summary.json",
      "version.json",
    ];
    const bundleText = (await Promise.all(
      produced.map((name) => readFile(join(incidentDir, name), "utf8")),
    )).join("\n");
    assert.doesNotMatch(bundleText, new RegExp(canaryPrivateKey, "u"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("captures systemd metadata into separate files when commands are available", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: [],
    });
    const calls = [];
    const result = await collectIncident({
      argv: [
        "--log-root",
        dir,
        "--network",
        "testnet",
        "--since",
        "2026-05-25T10:00:00.000Z",
        "--until",
        "2026-05-25T10:01:00.000Z",
      ],
      dependencies: {
        spawnSync(command, args) {
          calls.push([command, args]);
          return { signal: null, status: 0, stderr: "", stdout: `${command} ${args.join(" ")}\n` };
        },
      },
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    assert.deepEqual(calls.map(([command]) => command), ["git", "systemctl", "systemctl", "journalctl"]);
    assert.deepEqual(calls[1], ["systemctl", ["status", "ickb-bot-testnet.service", "--no-pager", "--lines=0"]]);
    assert.match(await readFile(join(result.incidentDir, "systemd.status.txt"), "utf8"), /ickb-bot-testnet\.service/u);
    const summary = JSON.parse(await readFile(join(result.incidentDir, "summary.json"), "utf8"));
    assert.equal(summary.systemd.included, true);
    assert.equal(summary.systemd.unit, "ickb-bot-testnet.service");
    assert.equal(summary.systemd.results.find((entry) => entry.file === "systemd.journal.txt").note, "last 200 entries inside the requested time window");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("keeps collecting incidents when git metadata lookup fails", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent("2026-05-25T10:00:00.000Z", "bot.run.started")],
      launches: [],
      stderr: [],
    });

    const result = await collectIncident({
      argv: commonArgs(dir),
      dependencies: {
        spawnSync() {
          throw new Error("git unavailable");
        },
      },
      now: () => new Date("2026-05-25T12:00:00.000Z"),
      root: rootDir,
    });

    const version = JSON.parse(await readFile(join(result.incidentDir, "version.json"), "utf8"));
    assert.equal(version.gitCommit, null);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

async function tempDir() {
  return mkdtemp(join(tmpdir(), "ickb-bot-incident-"));
}

async function writeFixtureLogs(root, { events, launches, stderr }) {
  const logDir = join(root, "bot", "testnet");
  await mkdirp(logDir);
  await writeFile(join(logDir, "bot.events.ndjson"), events.join(""), { mode: 0o600 });
  await writeFile(join(logDir, "launches.ndjson"), launches.join(""), { mode: 0o600 });
  await writeFile(join(logDir, "bot.stderr.log"), stderr.join(""), { mode: 0o600 });
  return logDir;
}

async function mkdirp(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

function botEvent(timestamp, type, fields = {}) {
  return `${JSON.stringify({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-fixture",
    iterationId: 1,
    timestamp,
    type,
    ...fields,
  })}\n`;
}

function launch(timestamp, type, fields = {}) {
  return `${JSON.stringify({
    version: 1,
    app: "bot-launcher",
    timestamp,
    type,
    status: null,
    signal: null,
    ...fields,
  })}\n`;
}

function txHash(byte) {
  return `0x${byte.repeat(32)}`;
}

function commonArgs(logRoot) {
  return [
    "--log-root",
    resolve(logRoot),
    "--network",
    "testnet",
    "--since",
    "2026-05-25T10:00:00.000Z",
    "--until",
    "2026-05-25T11:00:00.000Z",
    "--no-systemd",
  ];
}

async function mode(path) {
  return (await stat(path)).mode & 0o777;
}

async function splitReadHandle(path, chunks) {
  return {
    close() {
      return Promise.resolve();
    },
    readableWebStream() {
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
    },
    stat() {
      return stat(path);
    },
  };
}
