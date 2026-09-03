import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { errnoCode, firstSymlinkInPath } from "../../../packages/node-utils/src/index.ts";
import { checkIgnored, jsonReplacer } from "./command.ts";
import {
  DEFAULT_LOG_ROOT,
  SESSION_ROOT_FLAG,
  type DynamicArgs,
  type DynamicLoopDependencies,
  type ValidationSession,
} from "./model.ts";

const { dirname, isAbsolute, join, parse, relative, resolve, sep } = path;
const SESSION_ROOT_LABEL = "session root";

export async function resolveTesterConfig(
  value: string,
  root: string,
  dependencies: DynamicLoopDependencies,
): Promise<string> {
  const absolutePath = resolveConfiguredPath(root, value, "--tester-config");
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("--tester-config must stay inside the repo");
  }
  if (!checkIgnored(root, relativePath, dependencies)) {
    throw new Error(`Refusing to use non-ignored --tester-config: ${relativePath}`);
  }
  await assertNoSymlinkedPath(absolutePath, "tester config");
  return relativePath;
}

export async function resolveValidationSession(
  args: DynamicArgs,
  root: string,
  dependencies: DynamicLoopDependencies,
): Promise<ValidationSession> {
  const now = dependencies.now ?? Date.now;
  const pid = dependencies.pid ?? process.pid;
  const logRoot = resolveConfiguredPath(
    root,
    args.logRoot ?? DEFAULT_LOG_ROOT,
    "--log-root",
  );
  const sessionRoot = resolveConfiguredPath(
    root,
    args.sessionRoot ??
      join(
        logRoot,
        "validation",
        `dynamic-${String(Math.floor(now() / 1000))}-${String(pid)}`,
      ),
    SESSION_ROOT_FLAG,
  );
  assertContained(logRoot, sessionRoot, SESSION_ROOT_FLAG);
  assertValidationSessionShape(logRoot, sessionRoot);
  await assertNoSymlinkedPath(logRoot, "log root");
  await assertNoSymlinkedPath(sessionRoot, SESSION_ROOT_LABEL);

  const relativeSessionRoot = relative(root, sessionRoot);
  if (
    !relativeSessionRoot.startsWith("..") &&
    !isAbsolute(relativeSessionRoot) &&
    !checkIgnored(root, relativeSessionRoot, dependencies)
  ) {
    throw new Error(
      `Refusing to write non-ignored validation session root: ${relativeSessionRoot}`,
    );
  }

  try {
    await stat(sessionRoot);
    throw new Error(
      `Validation session root already exists: ${displayPath(root, sessionRoot)}`,
    );
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      throw error;
    }
  }
  const supervisorDir = join(sessionRoot, "supervisor");
  const chunksDir = join(sessionRoot, "chunks");
  return {
    logRoot,
    sessionRoot,
    supervisorDir,
    chunksDir,
    displayLogRoot: displayPath(root, logRoot),
    displaySessionRoot: displayPath(root, sessionRoot),
  };
}

export async function createValidationSession(session: ValidationSession): Promise<void> {
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL);
  await mkdir(dirname(session.sessionRoot), { recursive: true });
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL);
  try {
    await mkdir(session.sessionRoot);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(
        `Validation session root already exists: ${session.displaySessionRoot}`,
        { cause: error },
      );
    }
    throw error;
  }
  await mkdir(session.supervisorDir);
  await mkdir(session.chunksDir);
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL);
}

export async function writeLaunchArtifact(
  session: ValidationSession,
  args: DynamicArgs,
  root: string,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  const startedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  await writeFile(
    join(session.supervisorDir, "launch.json"),
    `${JSON.stringify(
      {
        version: 1,
        app: "dynamic-supervisor-loop",
        startedAt,
        pid: dependencies.pid ?? process.pid,
        root,
        logRoot: session.displayLogRoot,
        sessionRoot: session.displaySessionRoot,
        options: {
          testerConfig: args.testerConfig,
          preflightScript: args.preflightScript,
          supervisorLoopScript: args.supervisorLoopScript,
          maxChunks: args.maxChunks ?? null,
          chunkMaxRuns: args.chunkMaxRuns,
          stableLimit: args.stableLimit,
          chunkBackoffSeconds: args.chunkBackoffSeconds,
          betweenChunksSeconds: args.betweenChunksSeconds,
          childTimeoutSeconds: args.childTimeoutSeconds,
          commandTimeoutSeconds: args.commandTimeoutSeconds,
          chunkTimeoutSeconds: args.chunkTimeoutSeconds,
          preflightTimeoutSeconds: args.preflightTimeoutSeconds,
          keepGoing: args.keepGoing,
          supervisorArgCount: args.supervisorArgs.length,
        },
      },
      jsonReplacer,
      2,
    )}\n`,
  );
}

export async function writeSupervisorEvent(
  session: ValidationSession,
  record: Record<string, unknown>,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  await appendFile(
    join(session.supervisorDir, "events.ndjson"),
    `${JSON.stringify(
      {
        at: new Date((dependencies.now ?? Date.now)()).toISOString(),
        ...record,
      },
      jsonReplacer,
    )}\n`,
  );
}

export async function appendSupervisorStderr(
  session: ValidationSession,
  text: string,
): Promise<void> {
  await appendFile(join(session.supervisorDir, "stderr.log"), text);
}

function resolveConfiguredPath(root: string, value: string, flag: string): string {
  if (value === "") {
    throw new Error(`${flag} must not be empty`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relationship = relative(root, candidate);
  if (
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error(`${label} must stay under --log-root`);
  }
}

function assertValidationSessionShape(logRoot: string, sessionRoot: string): void {
  const parts = relative(logRoot, sessionRoot)
    .split(sep)
    .filter((part) => part !== "");
  if (parts.length === 2 && parts[0] === "validation") {
    return;
  }
  throw new Error(`${SESSION_ROOT_FLAG} must be <log-root>/validation/<session>`);
}

async function assertNoSymlinkedPath(filePath: string, label: string): Promise<void> {
  const parsed = parse(filePath);
  const symlink = await firstSymlinkInPath(filePath, parsed.root);
  if (symlink !== undefined) {
    throw new Error(`Refusing to use ${label} through symlinked path: ${symlink}`);
  }
}

export function displayPath(root: string, filePath: string): string {
  const relativePath = relative(root, filePath);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? filePath
    : relativePath;
}

export function chunkOutRootDisplay(
  session: ValidationSession,
  root: string,
  chunkIndex: number,
): string {
  return displayPath(root, join(session.chunksDir, `chunk-${padChunk(chunkIndex)}`));
}

function padChunk(index: number): string {
  return String(index).padStart(4, "0");
}
