import { constants } from "node:fs";
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  readdir as fsReaddir,
  readFile as fsReadFile,
  realpath as fsRealpath,
  type FileHandle,
} from "node:fs/promises";
import pathModule from "node:path";

import { logDirectoryLabel } from "../model/constants.ts";
import { ignoreError, isErrorCode, publicErrorMessage } from "../model/text.ts";
import type {
  DirentLike,
  IncidentDependencies,
  IncidentFileHandle,
  SourceStream,
  StatLike,
} from "../model/types.ts";

type LineHandler = (line: string, lineNumber: number) => void;

const { dirname, join, parse, relative, sep } = pathModule;
const noFollow = constants.O_NOFOLLOW;
const readOnlyNoFollow = constants.O_RDONLY | noFollow;
const writeNewFileFlags =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;

export async function processSourceLines(
  filePath: string,
  label: string,
  dependencies: IncidentDependencies,
  onLine: LineHandler,
): Promise<boolean> {
  const handle = await openSourceHandle(filePath, label, dependencies);
  if (handle === null) {
    return false;
  }

  try {
    const stream = sourceStream(handle);
    let lineNumber = 0;
    let pending = "";
    const decoder = new TextDecoder("utf-8");
    for await (const text of streamTextChunks(stream, decoder)) {
      pending += text;
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
    await ignoreError(handle.close());
  }
}

export async function openSourceHandle(
  path: string,
  label: string,
  dependencies: IncidentDependencies,
): Promise<IncidentFileHandle | null> {
  let stat: StatLike;
  try {
    stat = await (dependencies.lstat ?? safeLstat)(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
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

  let handle: (FileHandle | IncidentFileHandle) | undefined;
  try {
    handle = await (dependencies.open ?? safeOpen)(path, readOnlyNoFollow);
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new Error(`Source log is not a regular file: ${path}`);
    }
    return handle;
  } catch (error) {
    await ignoreError(handle?.close());
    if (isErrorCode(error, "ELOOP")) {
      throw new Error(`Refusing symlinked source log file: ${path}`, {
        cause: error,
      });
    }
    throw new Error(`Unable to read ${label}: ${publicErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export async function writeBundleOutputs(
  incidentDir: string,
  outputs: Map<string, string>,
  dependencies: IncidentDependencies,
): Promise<void> {
  for (const [name, text] of [...outputs].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    await writeBundleFile(join(incidentDir, name), text, dependencies);
  }
}

export async function prepareIncidentDirectory(
  logDir: string,
  incidentParent: string,
  incidentDir: string,
  dependencies: IncidentDependencies,
): Promise<void> {
  await assertRealDirectory(logDir, logDirectoryLabel, dependencies);
  await ensureDirectChildDirectory(
    incidentParent,
    "incident directory parent",
    dependencies,
  );
  await assertRealDirectory(incidentParent, "incident directory parent", dependencies);
  await (dependencies.mkdir ?? safeMkdir)(incidentDir, { mode: 0o700 });
  await assertRealDirectory(incidentDir, "incident directory", dependencies);
}

export async function assertRealDirectory(
  filePath: string,
  label: string,
  dependencies: IncidentDependencies,
): Promise<void> {
  if (filePath === "") {
    throw new Error(`Empty ${label} path`);
  }
  await assertNoSymlinkedPathComponents(filePath, label, dependencies);
  const stat = await (dependencies.lstat ?? safeLstat)(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked ${label}: ${filePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${filePath}`);
  }
  const resolved = await (dependencies.realpath ?? safeRealpath)(filePath);
  if (resolved !== filePath) {
    throw new Error(`Resolved ${label} crosses a symlink: ${filePath}`);
  }
}

export async function assertNoSymlinkedPathComponents(
  filePath: string,
  label: string,
  dependencies: IncidentDependencies,
): Promise<void> {
  const parsed = parse(filePath);
  let current = parsed.root;
  const parts = relative(parsed.root, filePath).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    let stat: StatLike;
    try {
      stat = await (dependencies.lstat ?? safeLstat)(current);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked ${label} path: ${current}`);
    }
  }
}

export async function readHandleText(
  handle: IncidentFileHandle,
  label: string,
): Promise<string> {
  if (handle.readFile === undefined) {
    throw new Error(`Unable to read ${label}: source handle is not readable`);
  }
  const text = await handle.readFile("utf8");
  return typeof text === "string" ? text : Buffer.from(text).toString("utf8");
}

export async function safeLstat(filePath: string): Promise<StatLike> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers prove collector-managed paths before filesystem use.
  return fsLstat(filePath);
}

export async function safeRealpath(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This is the symlink proof for the already resolved collector path.
  return fsRealpath(filePath);
}

export async function safeReadFile(
  filePath: string,
  encoding: BufferEncoding,
): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Reads target package metadata selected by the collector root.
  return fsReadFile(filePath, encoding);
}

export const safeReaddir: (
  directory: string,
  options: { withFileTypes: true },
) => Promise<DirentLike[]> = async (directory, options) => {
  // eslint-disable-next-line sonarjs/prefer-immediate-return, security/detect-non-literal-fs-filename -- Async wrapper is required by the local promise rule; directory reads stay under checked collector log paths.
  const entries = await fsReaddir(directory, options);
  return entries;
};

async function ensureDirectChildDirectory(
  filePath: string,
  label: string,
  dependencies: IncidentDependencies,
): Promise<void> {
  try {
    await (dependencies.mkdir ?? safeMkdir)(filePath, { mode: 0o700 });
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) {
      throw error;
    }
  }
  const stat = await (dependencies.lstat ?? safeLstat)(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked ${label}: ${filePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${filePath}`);
  }
}

async function writeBundleFile(
  filePath: string,
  text: string,
  dependencies: IncidentDependencies,
): Promise<void> {
  await (dependencies.mkdir ?? safeMkdir)(dirname(filePath), {
    recursive: true,
    mode: 0o700,
  });
  const handle = await (dependencies.open ?? safeOpen)(
    filePath,
    writeNewFileFlags,
    0o600,
  );
  try {
    if (handle.writeFile === undefined || handle.chmod === undefined) {
      throw new Error(`Unable to write incident bundle file: ${filePath}`);
    }
    await handle.writeFile(text, "utf8");
    await handle.chmod(0o600);
  } finally {
    await ignoreError(handle.close());
  }
}

function sourceStream(handle: IncidentFileHandle): SourceStream {
  // eslint-disable-next-line no-restricted-syntax -- FileHandle readableWebStream is async-iterable in Node, but the lib type is narrower here.
  return handle.readableWebStream() as SourceStream;
}

async function* streamTextChunks(
  stream: SourceStream,
  decoder: InstanceType<typeof TextDecoder>,
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    yield decoder.decode(chunk, { stream: true });
  }
}

async function safeOpen(
  filePath: string,
  flags: number,
  mode?: number,
): Promise<IncidentFileHandle> {
  // eslint-disable-next-line sonarjs/prefer-immediate-return, security/detect-non-literal-fs-filename -- Async wrapper is required by the local promise rule; opens checked collector files with no-follow flags and post-open file validation.
  const handle = await fsOpen(filePath, flags, mode);
  return handle;
}

async function safeMkdir(
  directory: string,
  options?: { mode?: number; recursive?: boolean },
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers build paths from resolved collector roots and checked path parts.
  await fsMkdir(directory, options);
}
