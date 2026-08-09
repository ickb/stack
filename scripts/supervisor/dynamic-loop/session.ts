import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { firstSymlinkInPath } from "../../../packages/node-utils/src/index.ts";
import { checkIgnored, jsonReplacer } from "./command.ts";
import {
  DEFAULT_LOG_ROOT,
  SESSION_ROOT_FLAG,
  type DynamicArgs,
  type DynamicLoopDependencies,
  type MaybePromise,
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
  await assertNoSymlinkedPath(absolutePath, "tester config", dependencies);
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
  await assertNoSymlinkedPath(logRoot, "log root", dependencies);
  await assertNoSymlinkedPath(sessionRoot, SESSION_ROOT_LABEL, dependencies);

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

  const statFn = fileStatReader(dependencies);
  try {
    await statFn(sessionRoot);
    throw new Error(
      `Validation session root already exists: ${displayPath(root, sessionRoot)}`,
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
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

export async function createValidationSession(
  session: ValidationSession,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  const mkdirFn = directoryCreator(dependencies);
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL, dependencies);
  await mkdirFn(dirname(session.sessionRoot), { recursive: true });
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL, dependencies);
  try {
    await mkdirFn(session.sessionRoot);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Validation session root already exists: ${session.displaySessionRoot}`,
        { cause: error },
      );
    }
    throw error;
  }
  await mkdirFn(session.supervisorDir);
  await mkdirFn(session.chunksDir);
  await assertNoSymlinkedPath(session.sessionRoot, SESSION_ROOT_LABEL, dependencies);
}

export async function writeLaunchArtifact(
  session: ValidationSession,
  args: DynamicArgs,
  root: string,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  const writeFileFn = fileWriter(dependencies);
  const startedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  await writeFileFn(
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
  const appendFileFn = fileAppender(dependencies);
  await appendFileFn(
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
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  const appendFileFn = fileAppender(dependencies);
  await appendFileFn(join(session.supervisorDir, "stderr.log"), text);
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

async function assertNoSymlinkedPath(
  filePath: string,
  label: string,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  const parsed = parse(filePath);
  const symlink = await firstSymlinkInPath(filePath, parsed.root, {
    ...(dependencies.lstat === undefined ? {} : { lstat: dependencies.lstat }),
  });
  if (symlink !== undefined) {
    throw new Error(`Refusing to use ${label} through symlinked path: ${symlink}`);
  }
}

async function defaultStat(filePath: string): Promise<unknown> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers resolve and validate dynamic-loop paths before probing them.
  return stat(filePath);
}

function fileStatReader(
  dependencies: DynamicLoopDependencies,
): (filePath: string) => MaybePromise<unknown> {
  return dependencies.stat ?? defaultStat;
}

async function defaultMkdir(
  filePath: string,
  options?: { recursive?: boolean },
): Promise<unknown> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Session paths are resolved, ignored, and symlink-checked before creation.
  return mkdir(filePath, options);
}

function directoryCreator(
  dependencies: DynamicLoopDependencies,
): (filePath: string, options?: { recursive?: boolean }) => MaybePromise<unknown> {
  return dependencies.mkdir ?? defaultMkdir;
}

async function defaultWriteFile(filePath: string, text: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers prove dynamic-loop-owned session paths before writing.
  await writeFile(filePath, text);
}

function fileWriter(
  dependencies: DynamicLoopDependencies,
): (filePath: string, text: string) => MaybePromise<unknown> {
  return dependencies.writeFile ?? defaultWriteFile;
}

async function defaultAppendFile(filePath: string, text: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers prove dynamic-loop-owned session paths before appending.
  await appendFile(filePath, text);
}

function fileAppender(
  dependencies: DynamicLoopDependencies,
): (filePath: string, text: string) => MaybePromise<unknown> {
  return dependencies.appendFile ?? defaultAppendFile;
}

export function displayPath(root: string, filePath: string): string {
  const relativePath = relative(root, filePath);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? filePath
    : relativePath;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
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
