#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const supportedNetworks = new Set(["testnet", "mainnet"]);
const noFollow = constants.O_NOFOLLOW ?? 0;
const logFileFlags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollow;
const signalNames = ["SIGINT", "SIGTERM", "SIGHUP"];

export function usage() {
  return `Usage: ickb-bot-launcher.mjs [--log-root PATH] (--network testnet|mainnet | --log-dir PATH) -- <command> [args...]\n`;
}

export function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { help: true };
  }

  const separator = argv.indexOf("--");
  if (separator === -1) {
    throw new Error("Missing -- before command");
  }

  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let logRoot;
  let network;
  let logDir;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--log-root") {
      logRoot = requireValue(options, index, option);
      index += 1;
    } else if (option === "--network") {
      network = requireValue(options, index, option);
      index += 1;
    } else if (option === "--log-dir") {
      logDir = requireValue(options, index, option);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  if (command.length === 0 || command[0] === "") {
    throw new Error("Missing child command");
  }
  if (network !== undefined && !supportedNetworks.has(network)) {
    throw new Error("Invalid network; expected testnet or mainnet");
  }
  if ((network === undefined) === (logDir === undefined)) {
    throw new Error("Specify exactly one of --network or --log-dir");
  }

  return {
    command: command[0],
    commandArgs: command.slice(1),
    logDir,
    logRoot,
    network,
  };
}

export function resolveLauncherPaths({ cliLogRoot, envLogRoot, logDir, network, root }) {
  const logRoot = resolveConfiguredPath(cliLogRoot ?? envLogRoot ?? "log", root, "log root");
  const resolvedLogDir = logDir === undefined
    ? join(logRoot, "bot", network)
    : resolveConfiguredPath(logDir, root, "log directory");

  assertContained(logRoot, resolvedLogDir, "log directory");
  return { logDir: resolvedLogDir, logRoot };
}

export async function runBotLauncher({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => new Date(),
  root = rootDir,
  spawnProcess = spawn,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`ickb-bot-launcher: ${publicErrorMessage(error)}\n${usage()}`);
    return { status: 1 };
  }

  if (parsed.help) {
    stdout.write(usage());
    return { status: 0 };
  }

  const startTime = Date.now();
  let sinks;
  let child;
  let removeSignalHandlers = () => undefined;

  try {
    const paths = resolveLauncherPaths({
      cliLogRoot: parsed.logRoot,
      envLogRoot: env.ICKB_BOT_LOG_ROOT,
      logDir: parsed.logDir,
      network: parsed.network,
      root,
    });
    await prepareLogDirectory(paths.logRoot);
    await prepareLogDirectory(paths.logDir);
    await proveResolvedPath(paths.logRoot, "log root");
    await proveResolvedPath(paths.logDir, "log directory");

    sinks = await openLogSinks(paths.logDir);
    const packageInfo = await readBotPackageInfo(root);
    const childCommand = safeCommandShape(parsed.command, parsed.commandArgs.length);
    child = spawnProcess(parsed.command, parsed.commandArgs, {
      cwd: root,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    const childResultPromise = waitForChild(child);

    removeSignalHandlers = forwardSignalsTo(child);

    await sinks.launches.writeLine({
      app: "bot-launcher",
      childPid: child.pid ?? null,
      command: childCommand,
      elapsedMs: 0,
      logDir: paths.logDir,
      logRoot: paths.logRoot,
      network: parsed.network ?? null,
      nodeVersion: process.version,
      package: packageInfo,
      pid: process.pid,
      repoRoot: root,
      signal: null,
      status: null,
      timestamp: now().toISOString(),
      type: "launcher.started",
      version: 1,
    });

    const stdoutCopy = copyBytes(child.stdout, sinks.events, stdout);
    const stderrCopy = copyBytes(child.stderr, sinks.stderr, stderr);
    const childResult = await childResultPromise;
    const copyResult = await settleCopies(stdoutCopy, stderrCopy);
    const elapsedMs = Date.now() - startTime;

    await sinks.launches.writeLine({
      app: "bot-launcher",
      childPid: child.pid ?? null,
      command: childCommand,
      elapsedMs,
      logDir: paths.logDir,
      logRoot: paths.logRoot,
      network: parsed.network ?? null,
      nodeVersion: process.version,
      package: packageInfo,
      pid: process.pid,
      signal: childResult.signal,
      status: childResult.status,
      timestamp: now().toISOString(),
      type: copyResult === undefined ? "launcher.child.exited" : "launcher.io.failed",
      version: 1,
    });

    await closeSinks(sinks);
    sinks = undefined;
    removeSignalHandlers();

    if (copyResult !== undefined) {
      stderr.write(`ickb-bot-launcher: ${publicErrorMessage(copyResult)}\n`);
      return { status: 1 };
    }
    if (childResult.error !== undefined) {
      stderr.write(`ickb-bot-launcher: Failed to spawn child process: ${publicErrorMessage(childResult.error)}\n`);
      return { status: 1 };
    }
    if (childResult.signal !== null) {
      return { signal: childResult.signal };
    }
    return { status: childResult.status ?? 1 };
  } catch (error) {
    removeSignalHandlers();
    if (child !== undefined && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
    if (sinks !== undefined) {
      await closeSinks(sinks).catch(() => undefined);
    }
    stderr.write(`ickb-bot-launcher: ${publicErrorMessage(error)}\n`);
    return { status: 1 };
  }
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function resolveConfiguredPath(value, root, label) {
  if (value === "") {
    throw new Error(`Empty ${label} path`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function assertContained(root, candidate, label) {
  const relationship = relative(root, candidate);
  if (relationship === "" || (relationship !== ".." && !relationship.startsWith(`..${sep}`) && !isAbsolute(relationship))) {
    return;
  }
  throw new Error(`${label} must stay inside the resolved log root`);
}

async function prepareLogDirectory(directory) {
  const parsed = parse(directory);
  let current = parsed.root;
  await assertDirectory(current);

  const parts = relative(parsed.root, directory).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    try {
      await assertDirectory(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      await mkdir(current, { mode: 0o700 });
      await assertDirectory(current);
    }
  }
}

async function assertDirectory(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked log directory path: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Log directory path is not a directory: ${path}`);
  }
}

async function proveResolvedPath(path, label) {
  const real = await realpath(path);
  if (real !== path) {
    throw new Error(`Resolved ${label} crosses a symlink`);
  }
}

async function openLogSinks(logDir) {
  return {
    events: await openLogSink(join(logDir, "bot.events.ndjson")),
    launches: await openLogSink(join(logDir, "launches.ndjson")),
    stderr: await openLogSink(join(logDir, "bot.stderr.log")),
  };
}

async function openLogSink(path) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked log file path: ${path}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${path}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const handle = await open(path, logFileFlags, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${path}`);
    }
    await handle.chmod(0o600);
    return new LogSink(handle);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export class LogSink {
  #pending = Promise.resolve();

  constructor(handle) {
    this.handle = handle;
  }

  write(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    this.#pending = this.#pending.then(() => this.handle.appendFile(data));
    return this.#pending;
  }

  writeLine(record) {
    return this.write(`${JSON.stringify(record)}\n`);
  }

  async close() {
    try {
      await this.#pending;
    } finally {
      await this.handle.close();
    }
  }
}

export function copyBytes(readable, fileSink, tee) {
  if (readable === null) {
    return Promise.resolve();
  }

  let pending = Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    readable.on("data", (chunk) => {
      readable.pause();
      pending = pending
        .then(async () => {
          await fileSink.write(chunk);
          await writeToStream(tee, chunk);
        })
        .then(
          () => readable.resume(),
          (error) => {
            rejectPromise(error);
            readable.destroy(error);
          },
        );
    });
    readable.once("end", () => pending.then(resolvePromise, rejectPromise));
    readable.once("error", rejectPromise);
  });
}

function writeToStream(stream, chunk) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        setImmediate(() => {
          stream.off("error", finish);
          resolvePromise();
        });
      }
    };

    stream.once("error", finish);
    try {
      stream.write(chunk, finish);
    } catch {
      finish();
    }
  });
}

function waitForChild(child) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (result) => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };
    child.once("error", (error) => settle({ error, signal: null, status: 1 }));
    child.once("close", (status, signal) => settle({ signal, status }));
  });
}

async function settleCopies(...copies) {
  const results = await Promise.allSettled(copies);
  const failed = results.find((result) => result.status === "rejected");
  return failed?.reason;
}

function forwardSignalsTo(child) {
  const handlers = signalNames.map((signal) => {
    const handler = () => {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}

function safeCommandShape(command, argumentCount) {
  return {
    argumentCount,
    arguments: Array.from({ length: argumentCount }, (_, index) => ({
      index,
      value: "<omitted>",
    })),
    executable: basename(command),
  };
}

async function readBotPackageInfo(root) {
  try {
    const text = await readFile(join(root, "apps/bot/package.json"), "utf8");
    const parsed = JSON.parse(text);
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      version: typeof parsed.version === "string" ? parsed.version : null,
    };
  } catch {
    return null;
  }
}

async function closeSinks(sinks) {
  await Promise.all([
    sinks.events.close(),
    sinks.launches.close(),
    sinks.stderr.close(),
  ]);
}

function publicErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown launcher error";
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const result = await runBotLauncher();
  if (result.signal !== undefined) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.status);
  }
}
