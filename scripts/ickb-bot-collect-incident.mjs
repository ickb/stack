#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveLauncherPaths } from "./ickb-bot-launcher.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const supportedNetworks = new Set(["testnet", "mainnet"]);
const sourceFiles = [
  { kind: "botEvents", name: "bot.events.ndjson" },
  { kind: "stderr", name: "bot.stderr.log" },
  { kind: "launches", name: "launches.ndjson" },
];
const scriptVersion = 1;
const stderrUndatedLineLimit = 200;
const noFollow = constants.O_NOFOLLOW ?? 0;
const readOnlyNoFollow = constants.O_RDONLY | noFollow;
const writeNewFileFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;

export function usage() {
  return [
    "Usage: node scripts/ickb-bot-collect-incident.mjs [--log-root PATH] (--network testnet|mainnet | --log-dir PATH) --since <iso|relative> --until <iso|relative> [--no-systemd]",
    "Relative times use the current time, for example --since 2h --until now.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = { includeSystemd: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "--log-root") {
      args.logRoot = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--network") {
      args.network = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--log-dir") {
      args.logDir = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--since") {
      args.since = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--until") {
      args.until = requireValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--no-systemd") {
      args.includeSystemd = false;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (args.network !== undefined && !supportedNetworks.has(args.network)) {
    throw new Error("Invalid network; expected testnet or mainnet");
  }
  if ((args.network === undefined) === (args.logDir === undefined)) {
    throw new Error("Specify exactly one of --network or --log-dir");
  }
  if (args.since === undefined) {
    throw new Error("Missing required --since");
  }
  if (args.until === undefined) {
    throw new Error("Missing required --until");
  }

  return args;
}

export function parseTimeBound(value, now) {
  if (value === "now") {
    return new Date(now.getTime());
  }

  const relativeMatch = /^(\d+)(ms|s|m|h|d)(?:\s+ago)?$/u.exec(value);
  if (relativeMatch !== null) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    if (!Number.isSafeInteger(amount)) {
      throw new Error(`Invalid time bound: ${value}`);
    }
    const multipliers = { d: 86_400_000, h: 3_600_000, m: 60_000, ms: 1, s: 1_000 };
    const timestamp = now.getTime() - amount * multipliers[unit];
    if (!Number.isFinite(timestamp)) {
      throw new Error(`Invalid time bound: ${value}`);
    }
    return new Date(timestamp);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid time bound: ${value}`);
  }
  return parsed;
}

export async function collectIncident({
  argv = process.argv.slice(2),
  envLogRoot = process.env.ICKB_BOT_LOG_ROOT,
  now = () => new Date(),
  root = rootDir,
  dependencies = {},
} = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    return { help: usage() };
  }

  const createdAt = now();
  const since = parseTimeBound(parsed.since, createdAt);
  const until = parseTimeBound(parsed.until, createdAt);
  if (since.getTime() > until.getTime()) {
    throw new Error("--since must be before or equal to --until");
  }

  const paths = resolveIncidentPaths({ parsed, envLogRoot, root });
  await assertRealDirectory(paths.logRoot, "log root", dependencies);
  await assertRealDirectory(paths.logDir, "log directory", dependencies);

  const summary = createSummary({
    createdAt,
    logDir: paths.logDir,
    logRoot: paths.logRoot,
    logRootSource: paths.logRootSource,
    network: paths.network,
    since,
    until,
  });
  const outputs = new Map();

  for (const source of sourceFiles) {
    const sourcePath = join(paths.logDir, source.name);
    const result = source.kind === "stderr"
      ? await filterStderrSource(sourcePath, source.name, since, until, dependencies)
      : await filterJsonSource(sourcePath, source.name, since, until, summary, source.kind, dependencies);
    if (result === null) {
      summary.sources[source.name] = { included: false, path: sourcePath, reason: "missing" };
      continue;
    }

    summary.sources[source.name] = {
      included: true,
      output: source.name,
      path: sourcePath,
      ...result.stats,
    };
    if (source.kind === "stderr") {
      summary.stderr.firstTimestamp = result.stats.firstTimestamp;
      summary.stderr.lastTimestamp = result.stats.lastTimestamp;
    }
    summary.sourceFiles.push({
      name: source.name,
      output: source.name,
      path: sourcePath,
      selectedLines: result.stats.selectedLines,
    });
    outputs.set(source.name, result.text);
  }

  const version = await buildVersionMetadata(root, dependencies);
  outputs.set("version.json", `${JSON.stringify(version, null, 2)}\n`);

  if (parsed.includeSystemd) {
    const systemd = captureSystemd(paths.network, since, until, dependencies);
    summary.systemd = systemd.summary;
    for (const [name, text] of systemd.outputs) {
      outputs.set(name, text);
    }
  } else {
    summary.systemd = { included: false, reason: "disabled by --no-systemd" };
  }

  const incidentId = buildIncidentId(createdAt, paths.network);
  const incidentParent = join(paths.logDir, "incidents");
  const incidentDir = join(incidentParent, incidentId);
  summary.incidentId = incidentId;
  summary.incidentDir = incidentDir;
  summary.compression = {
    created: false,
    command: `tar -czf ${shellQuote(join(incidentParent, `${incidentId}.tar.gz`))} -C ${shellQuote(incidentParent)} ${shellQuote(incidentId)}`,
    reason: "The collector avoids assuming tar/gzip/zstd binaries are present.",
  };
  outputs.set("README.txt", incidentReadme(summary));
  outputs.set("summary.json", `${JSON.stringify(summary, null, 2)}\n`);

  await prepareIncidentDirectory(paths.logDir, incidentParent, incidentDir, dependencies);
  for (const [name, text] of [...outputs].sort(([left], [right]) => left.localeCompare(right))) {
    await writeBundleFile(join(incidentDir, name), text, dependencies);
  }

  return { incidentDir, incidentId, summary };
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await collectIncident({ argv });
    if (result.help !== undefined) {
      stdout.write(`${result.help}\n`);
      return 0;
    }
    stdout.write(`Incident bundle directory: ${result.incidentDir}\n`);
    stdout.write(`Compression command: ${result.summary.compression.command}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Incident collection failed: ${publicErrorMessage(error)}\n${usage()}\n`);
    return 1;
  }
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function resolveIncidentPaths({ parsed, envLogRoot, root }) {
  const logRootSource = parsed.logRoot !== undefined
    ? "cli"
    : envLogRoot !== undefined
      ? "env:ICKB_BOT_LOG_ROOT"
      : "default:log";
  const paths = resolveLauncherPaths({
    cliLogRoot: parsed.logRoot,
    envLogRoot,
    logDir: parsed.logDir,
    network: parsed.network,
    root,
  });
  return {
    ...paths,
    logRootSource,
    network: parsed.network ?? inferNetwork(paths.logDir),
  };
}

function inferNetwork(logDir) {
  const name = basename(logDir);
  return supportedNetworks.has(name) ? name : null;
}

function createSummary({ createdAt, logDir, logRoot, logRootSource, network, since, until }) {
  return {
    version: 1,
    scriptVersion,
    createdAt: createdAt.toISOString(),
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
    },
    logRoot,
    logRootSource,
    logDir,
    network,
    sourceFiles: [],
    sources: {},
    botEvents: {
      countsByType: {},
      failureReasons: {},
      firstTimestamp: null,
      lastTimestamp: null,
      skipReasons: {},
      txHashesByOutcome: {},
    },
    launches: {
      countsByType: {},
      exitCodes: {},
      firstTimestamp: null,
      lastTimestamp: null,
      signals: {},
    },
    stderr: {
      firstTimestamp: null,
      lastTimestamp: null,
    },
  };
}

async function openSourceHandle(path, label, dependencies) {
  let stat;
  try {
    stat = await (dependencies.lstat ?? lstat)(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked source log file: ${path}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Source log is not a regular file: ${path}`);
  }

  let handle;
  try {
    handle = await (dependencies.open ?? open)(path, readOnlyNoFollow);
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new Error(`Source log is not a regular file: ${path}`);
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.code === "ELOOP") {
      throw new Error(`Refusing symlinked source log file: ${path}`);
    }
    throw new Error(`Unable to read ${label}: ${publicErrorMessage(error)}`);
  }
}

async function processSourceLines(path, label, dependencies, onLine) {
  const handle = await openSourceHandle(path, label, dependencies);
  if (handle === null) {
    return false;
  }

  try {
    let lineNumber = 0;
    let pending = "";
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of handle.readableWebStream({ type: "bytes" })) {
      pending += decoder.decode(chunk, { stream: true });
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) {
        lineNumber += 1;
        onLine(`${part}\n`, lineNumber);
      }
    }
    pending += decoder.decode();
    if (pending !== "") {
      onLine(pending, lineNumber + 1);
    }
    return true;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function filterJsonSource(path, sourceName, since, until, summary, kind, dependencies) {
  const selected = [];
  const stats = emptySourceStats();

  const found = await processSourceLines(path, sourceName, dependencies, (line, lineNumber) => {
    if (line.trim() === "") {
      stats.emptyLines += 1;
      return;
    }
    stats.totalLines += 1;

    let record;
    try {
      record = JSON.parse(stripLineEnding(line));
    } catch {
      stats.malformedLines += 1;
      return;
    }

    const timestamp = parseRecordTimestamp(record?.timestamp);
    if (timestamp === null) {
      stats.undatedLines += 1;
      return;
    }
    if (!timestampInWindow(timestamp, since, until)) {
      stats.outsideWindowLines += 1;
      return;
    }

    selected.push(line.endsWith("\n") ? line : `${line}\n`);
    stats.selectedLines += 1;
    updateStatsTimestamps(stats, timestamp);
    if (kind === "botEvents") {
      summarizeBotEvent(record, summary, timestamp);
    } else {
      summarizeLaunch(record, summary, timestamp);
    }
  });
  if (!found) {
    return null;
  }

  return { stats, text: selected.join("") };
}

async function filterStderrSource(path, sourceName, since, until, dependencies) {
  const selected = [];
  const stats = emptySourceStats();
  const undatedTail = [];
  let selectedSinceLastTimestamp = false;

  const found = await processSourceLines(path, sourceName, dependencies, (line, lineNumber) => {
    if (line.trim() === "") {
      stats.emptyLines += 1;
      return;
    }
    stats.totalLines += 1;
    const timestamp = parseTextTimestamp(line);
    if (timestamp === null) {
      stats.undatedLines += 1;
      rememberUndatedTail(undatedTail, { line }, stderrUndatedLineLimit);
      if (selectedSinceLastTimestamp) {
        appendSelectedStderrLine(selected, stats, line);
        stats.selectedUndatedLines += 1;
      }
      return;
    }
    stats.timestampedLines += 1;
    selectedSinceLastTimestamp = false;
    if (!timestampInWindow(timestamp, since, until)) {
      stats.outsideWindowLines += 1;
      return;
    }

    appendSelectedStderrLine(selected, stats, line);
    selectedSinceLastTimestamp = true;
    updateStatsTimestamps(stats, timestamp);
  });
  if (!found) {
    return null;
  }

  if (selected.length === 0 && stats.undatedLines > 0 && stats.timestampedLines === 0) {
    for (const { line } of undatedTail) {
      appendSelectedStderrLine(selected, stats, line);
    }
    stats.selectedUndatedLines = undatedTail.length;
    stats.undatedTailIncluded = true;
    stats.undatedTailLimit = stderrUndatedLineLimit;
  }

  return { stats, text: selected.join("") };
}

function emptySourceStats() {
  return {
    emptyLines: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    malformedLines: 0,
    outsideWindowLines: 0,
    selectedLines: 0,
    selectedUndatedLines: 0,
    timestampedLines: 0,
    totalLines: 0,
    undatedTailIncluded: false,
    undatedTailLimit: null,
    undatedLines: 0,
  };
}

function rememberUndatedTail(tail, entry, limit) {
  tail.push(entry);
  if (tail.length > limit) {
    tail.shift();
  }
}

function appendSelectedStderrLine(selected, stats, line) {
  selected.push(line.endsWith("\n") ? line : `${line}\n`);
  stats.selectedLines += 1;
}

function stripLineEnding(line) {
  const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
  return withoutNewline.endsWith("\r") ? withoutNewline.slice(0, -1) : withoutNewline;
}

function parseRecordTimestamp(timestamp) {
  if (typeof timestamp !== "string") {
    return null;
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTextTimestamp(line) {
  const match = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})/u.exec(line);
  if (match === null) {
    return null;
  }
  const parsed = new Date(match[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function timestampInWindow(timestamp, since, until) {
  const value = timestamp.getTime();
  return since.getTime() <= value && value <= until.getTime();
}

function updateStatsTimestamps(stats, timestamp) {
  const iso = timestamp.toISOString();
  if (stats.firstTimestamp === null || iso < stats.firstTimestamp) {
    stats.firstTimestamp = iso;
  }
  if (stats.lastTimestamp === null || iso > stats.lastTimestamp) {
    stats.lastTimestamp = iso;
  }
}

function summarizeBotEvent(record, summary, timestamp) {
  if (record?.app !== "bot" || typeof record.type !== "string" || !record.type.startsWith("bot.")) {
    return;
  }

  increment(summary.botEvents.countsByType, record.type);
  updateSummaryTimestamps(summary.botEvents, timestamp);
  if (typeof record.outcome === "string" && typeof record.txHash === "string") {
    addGroupedUnique(summary.botEvents.txHashesByOutcome, record.outcome, record.txHash);
  }
  if (record.type === "bot.decision.skipped") {
    increment(summary.botEvents.skipReasons, stringReason(record.reason));
  }
  if (record.type === "bot.transaction.failed" || record.type === "bot.iteration.failed") {
    increment(summary.botEvents.failureReasons, failureReason(record));
  }
}

function summarizeLaunch(record, summary, timestamp) {
  if (record?.app !== "bot-launcher" || typeof record.type !== "string") {
    return;
  }

  increment(summary.launches.countsByType, record.type);
  updateSummaryTimestamps(summary.launches, timestamp);
  if (record.status !== undefined && record.status !== null) {
    increment(summary.launches.exitCodes, String(record.status));
  }
  if (record.signal !== undefined && record.signal !== null) {
    increment(summary.launches.signals, String(record.signal));
  }
}

function updateSummaryTimestamps(summary, timestamp) {
  const iso = timestamp.toISOString();
  if (summary.firstTimestamp === null || iso < summary.firstTimestamp) {
    summary.firstTimestamp = iso;
  }
  if (summary.lastTimestamp === null || iso > summary.lastTimestamp) {
    summary.lastTimestamp = iso;
  }
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function addGroupedUnique(groups, key, value) {
  groups[key] ??= [];
  if (!groups[key].includes(value)) {
    groups[key].push(value);
  }
}

function stringReason(value) {
  return typeof value === "string" && value !== "" ? value : "<missing>";
}

function failureReason(record) {
  if (record.type === "bot.iteration.failed" && record.retryBudgetExhausted === true) {
    return "retry_budget_exhausted";
  }
  if (typeof record.outcome === "string" && record.outcome !== "") {
    return record.outcome;
  }
  if (typeof record.reason === "string" && record.reason !== "") {
    return record.reason;
  }
  if (typeof record.error === "string" && record.error !== "") {
    return record.error;
  }
  if (typeof record.error === "object" && record.error !== null) {
    if (typeof record.error.message === "string" && record.error.message !== "") {
      return record.error.message;
    }
    if (typeof record.error.name === "string" && record.error.name !== "") {
      return record.error.name;
    }
  }
  return "<missing>";
}

async function buildVersionMetadata(root, dependencies) {
  const [rootPackage, botPackage] = await Promise.all([
    readPackage(join(root, "package.json")),
    readPackage(join(root, "apps/bot/package.json")),
  ]);
  return {
    script: {
      name: "ickb-bot-collect-incident.mjs",
      version: scriptVersion,
    },
    nodeVersion: process.version,
    package: {
      packageManager: rootPackage?.packageManager ?? null,
      private: rootPackage?.private === true,
    },
    botPackage: botPackage === null
      ? null
      : {
        name: typeof botPackage.name === "string" ? botPackage.name : null,
        version: typeof botPackage.version === "string" ? botPackage.version : null,
      },
    gitCommit: readGitCommit(root, dependencies),
  };
}

async function readPackage(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function readGitCommit(root, dependencies) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const result = spawn("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 });
  if (result.status !== 0) {
    return null;
  }
  const commit = result.stdout.trim();
  return commit === "" ? null : commit;
}

function captureSystemd(network, since, until, dependencies) {
  if (!supportedNetworks.has(network)) {
    return {
      outputs: new Map(),
      summary: { included: false, reason: "network unavailable for systemd unit derivation" },
    };
  }

  const unit = `ickb-bot-${network}.service`;
  const commands = [
    { args: ["status", unit, "--no-pager", "--lines=0"], file: "systemd.status.txt", name: "systemctl status" },
    { args: ["cat", unit, "--no-pager"], file: "systemd.unit.txt", name: "systemctl cat" },
    {
      args: [
        "-u",
        unit,
        "--since",
        since.toISOString(),
        "--until",
        until.toISOString(),
        "-n",
        "200",
        "--no-pager",
        "--output",
        "short-iso",
      ],
      command: "journalctl",
      file: "systemd.journal.txt",
      note: "last 200 entries inside the requested time window",
      name: "journalctl",
    },
  ];
  const outputs = new Map();
  const results = [];
  const spawn = dependencies.spawnSync ?? spawnSync;

  for (const command of commands) {
    const executable = command.command ?? "systemctl";
    const result = spawn(executable, command.args, {
      encoding: "utf8",
      maxBuffer: 1_000_000,
      timeout: 5_000,
    });
    const text = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "");
    results.push({
      command: executable,
      args: command.args,
      file: command.file,
      name: command.name,
      note: command.note ?? null,
      signal: result.signal ?? null,
      status: result.status ?? null,
      error: result.error === undefined ? null : publicErrorMessage(result.error),
      captured: text !== "",
    });
    if (text !== "") {
      outputs.set(command.file, text.endsWith("\n") ? text : `${text}\n`);
    }
  }

  return {
    outputs,
    summary: {
      included: outputs.size > 0,
      unit,
      results,
    },
  };
}

function buildIncidentId(createdAt, network) {
  const stamp = createdAt.toISOString().replace(/[-:.]/gu, "");
  return `${stamp}-${network ?? "custom"}-${process.pid.toString(36)}-${randomBytes(3).toString("hex")}`;
}

function shellQuote(value) {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function incidentReadme(summary) {
  return [
    `Incident: ${summary.incidentId}`,
    `Window: ${summary.window.since} to ${summary.window.until}`,
    `Log directory: ${summary.logDir}`,
    "",
    "Files are source-separated: bot.events.ndjson, bot.stderr.log, and launches.ndjson are never merged.",
    "summary.json contains event counts, transaction outcomes, skip/failure reasons, exit codes, and source inclusion stats.",
    "version.json contains collector, package, Node, and git metadata. Config files and environment dumps are intentionally not included.",
    "",
    `Compression command: ${summary.compression.command}`,
    "",
  ].join("\n");
}

async function prepareIncidentDirectory(logDir, incidentParent, incidentDir, dependencies) {
  await assertRealDirectory(logDir, "log directory", dependencies);
  await ensureDirectChildDirectory(incidentParent, "incident directory parent", dependencies);
  await assertRealDirectory(incidentParent, "incident directory parent", dependencies);
  await (dependencies.mkdir ?? mkdir)(incidentDir, { mode: 0o700 });
  await assertRealDirectory(incidentDir, "incident directory", dependencies);
}

async function ensureDirectChildDirectory(path, label, dependencies) {
  try {
    await (dependencies.mkdir ?? mkdir)(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
  const stat = await (dependencies.lstat ?? lstat)(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked ${label}: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

async function assertRealDirectory(path, label, dependencies) {
  if (path === "") {
    throw new Error(`Empty ${label} path`);
  }
  await assertNoSymlinkedPathComponents(path, label, dependencies);
  const stat = await (dependencies.lstat ?? lstat)(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked ${label}: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
  const resolved = await (dependencies.realpath ?? realpath)(path);
  if (resolved !== path) {
    throw new Error(`Resolved ${label} crosses a symlink: ${path}`);
  }
}

async function assertNoSymlinkedPathComponents(path, label, dependencies) {
  const parsed = parse(path);
  let current = parsed.root;
  const parts = relative(parsed.root, path).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try {
      stat = await (dependencies.lstat ?? lstat)(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked ${label} path: ${current}`);
    }
  }
}

async function writeBundleFile(path, text, dependencies) {
  const handle = await (dependencies.open ?? open)(path, writeNewFileFlags, 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown incident collector error";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main(process.argv.slice(2)));
}
