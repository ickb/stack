import { mkdir } from "node:fs/promises";
import path from "node:path";
import { firstSymlinkInPath } from "../../../packages/node-utils/src/index.ts";
import {
  SUPERVISOR_OUTPUT_ROOT,
  type LoopOutRoot,
  type MaybePromise,
  type SupervisorLoopDependencies,
} from "./model.ts";

const { dirname, isAbsolute, parse, relative, resolve: resolvePath } = path;

export function resolveLoopOutRoot(root: string, outRoot: string): LoopOutRoot {
  if (outRoot === "") {
    throw new Error("--out-root must not be empty");
  }
  const absolutePath = isAbsolute(outRoot) ? outRoot : resolvePath(root, outRoot);
  const relativePath = displayPath(root, absolutePath);
  if (!isAllowedLoopOutRoot(absolutePath, relativePath)) {
    throw new Error(
      `--out-root must be under ${SUPERVISOR_OUTPUT_ROOT} or a validation session chunks directory`,
    );
  }
  return { absolutePath, relativePath };
}

function isAllowedLoopOutRoot(absolutePath: string, relativePath: string): boolean {
  return (
    relativePath === SUPERVISOR_OUTPUT_ROOT ||
    relativePath.startsWith(`${SUPERVISOR_OUTPUT_ROOT}/`) ||
    isValidationChunkRoot(absolutePath)
  );
}

function isValidationChunkRoot(candidatePath: string): boolean {
  const parts = candidatePath.split(/[\\/]+/u);
  for (let index = 0; index < parts.length - 3; index += 1) {
    if (
      parts[index] === "validation" &&
      parts[index + 2] === "chunks" &&
      /^chunk-\d{4}$/u.test(parts[index + 3] ?? "") &&
      index + 4 === parts.length
    ) {
      return true;
    }
  }
  return false;
}

export function defaultOutRoot(nowMs: number, pid: number): string {
  return `${SUPERVISOR_OUTPUT_ROOT}/loop-${String(Math.floor(nowMs / 1000))}-${String(pid)}`;
}

async function assertNoSymlinkedLoopOutputAncestors(
  root: string,
  absolutePath: string,
  dependencies: SupervisorLoopDependencies,
): Promise<void> {
  const base = isInside(root, absolutePath) ? root : parse(absolutePath).root;
  const symlink = await firstSymlinkInPath(absolutePath, base, {
    ...(dependencies.lstat === undefined ? {} : { lstat: dependencies.lstat }),
  });
  if (symlink !== undefined) {
    throw new Error(
      `Refusing to use loop output root through symlinked path: ${displayPath(root, symlink)}`,
    );
  }
}

export async function reserveLoopOutRoot(
  root: string,
  absolutePath: string,
  dependencies: SupervisorLoopDependencies,
): Promise<void> {
  const mkdirFn = directoryCreator(dependencies);
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath, dependencies);
  await mkdirFn(dirname(absolutePath), { recursive: true });
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath, dependencies);
  try {
    await mkdirFn(absolutePath);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Refusing to reuse loop output root: ${displayPath(root, absolutePath)}`,
        { cause: error },
      );
    }
    throw error;
  }
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath, dependencies);
}

function isInside(root: string, candidatePath: string): boolean {
  const relationship = relative(root, candidatePath);
  return (
    relationship === "" || (!relationship.startsWith("..") && !isAbsolute(relationship))
  );
}

export function displayPath(root: string, candidatePath: string): string {
  return isInside(root, candidatePath) ? relative(root, candidatePath) : candidatePath;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function directoryCreator(
  dependencies: SupervisorLoopDependencies,
): (path: string, options?: { recursive?: boolean }) => MaybePromise<unknown> {
  return dependencies.mkdir ?? makeDirectory;
}

async function makeDirectory(
  directoryPath: string,
  options?: { recursive?: boolean },
): Promise<unknown> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers prove supervisor output roots before directory creation.
  return mkdir(directoryPath, options);
}
