import { firstSymlinkInPath } from "@ickb/node-utils";
import { mkdir, realpath } from "node:fs/promises";
import pathModule from "node:path";
import process from "node:process";
import {
  SESSION_ROOT_FLAG,
  SUMMARY_JSON,
  SUPERVISOR_DIR,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  Dependencies,
  ParsedStimulusArgs,
  SessionPaths,
} from "../shared/liveBotStimulusTypes.ts";
import {
  assertContained,
  assertValidationSessionShape,
  displayPath,
  isAlreadyExistsError,
  now,
  resolveConfiguredPath,
} from "../shared/liveBotStimulusUtils.ts";
const { dirname, join, parse } = pathModule;
const SESSION_ROOT_LABEL = "session root";

/**
 * Resolves and validates live bot stimulus session paths.
 *
 * @remarks
 * The session root must stay under the configured log root and match the
 * validation session shape.
 */
export function resolveSessionPaths(
  args: ParsedStimulusArgs,
  root: string,
  dependencies: Dependencies,
): SessionPaths {
  const logRoot = resolveConfiguredPath(args.logRoot, root, "--log-root");
  const sessionRoot = resolveConfiguredPath(
    args.sessionRoot ??
      join(
        logRoot,
        "validation",
        `live-bot-stimulus-${String(Math.floor(now(dependencies) / 1000))}-${String(process.pid)}`,
      ),
    root,
    SESSION_ROOT_FLAG,
  );
  assertContained(logRoot, sessionRoot, SESSION_ROOT_FLAG);
  assertValidationSessionShape(logRoot, sessionRoot);
  const botLogDir = join(logRoot, "bot");
  return {
    logRoot,
    sessionRoot,
    supervisorDir: join(sessionRoot, SUPERVISOR_DIR),
    chunksDir: join(sessionRoot, "chunks"),
    botLogDir,
    botEventsPath: join(botLogDir, "bot.events.ndjson"),
    launchesPath: join(botLogDir, "launches.ndjson"),
    summaryPath: join(sessionRoot, SUMMARY_JSON),
    displaySessionRoot: displayPath(root, sessionRoot),
    displayBotEventsPath: displayPath(root, join(botLogDir, "bot.events.ndjson")),
  };
}

export async function prepareSession(
  paths: SessionPaths,
  dependencies: Dependencies,
): Promise<void> {
  const mkdirFn = dependencies.mkdir ?? mkdir;
  await assertNoSymlinkedPath(paths.logRoot, "log root", dependencies);
  await mkdirFn(paths.logRoot, { recursive: true, mode: 0o700 });
  await assertNoSymlinkedPath(paths.logRoot, "log root", dependencies);
  await assertNoSymlinkedPath(paths.botLogDir, "bot log directory", dependencies);
  await assertNoSymlinkedPath(paths.sessionRoot, SESSION_ROOT_LABEL, dependencies);
  await mkdirFn(dirname(paths.sessionRoot), { recursive: true, mode: 0o700 });
  await assertNoSymlinkedPath(paths.sessionRoot, SESSION_ROOT_LABEL, dependencies);
  try {
    await mkdirFn(paths.sessionRoot, { mode: 0o700 });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Validation session root already exists: ${paths.displaySessionRoot}`,
        { cause: error },
      );
    }
    throw error;
  }
  await mkdirFn(paths.supervisorDir, { mode: 0o700 });
  await mkdirFn(paths.chunksDir, { mode: 0o700 });
  await assertNoSymlinkedPath(paths.sessionRoot, SESSION_ROOT_LABEL, dependencies);
  await proveRealpathContained(paths.logRoot, paths.sessionRoot, dependencies);
}

async function proveRealpathContained(
  logRoot: string,
  sessionRoot: string,
  dependencies: Dependencies,
): Promise<void> {
  const realpathFn = dependencies.realpath ?? realpath;
  const [realLogRoot, realSessionRoot] = await Promise.all([
    realpathFn(logRoot),
    realpathFn(sessionRoot),
  ]);
  assertContained(realLogRoot, realSessionRoot, `resolved ${SESSION_ROOT_FLAG}`);
}

async function assertNoSymlinkedPath(
  targetPath: string,
  label: string,
  dependencies: Dependencies,
): Promise<void> {
  const parsed = parse(targetPath);
  const symlink = await firstSymlinkInPath(targetPath, parsed.root, {
    ...(dependencies.lstat === undefined ? {} : { lstat: dependencies.lstat }),
  });
  if (symlink !== undefined) {
    throw new Error(`Refusing to use ${label} through symlinked path: ${symlink}`);
  }
}
