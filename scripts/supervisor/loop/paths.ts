import { mkdir } from "node:fs/promises";
import path from "node:path";
import { errnoCode, firstSymlinkInPath } from "../../../packages/node-utils/src/index.ts";
import { SUPERVISOR_OUTPUT_ROOT, type LoopOutRoot } from "./model.ts";

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
): Promise<void> {
  const base = isInside(root, absolutePath) ? root : parse(absolutePath).root;
  const symlink = await firstSymlinkInPath(absolutePath, base);
  if (symlink !== undefined) {
    throw new Error(
      `Refusing to use loop output root through symlinked path: ${displayPath(root, symlink)}`,
    );
  }
}

export async function reserveLoopOutRoot(
  root: string,
  absolutePath: string,
): Promise<void> {
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath);
  try {
    await mkdir(absolutePath);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(
        `Refusing to reuse loop output root: ${displayPath(root, absolutePath)}`,
        { cause: error },
      );
    }
    throw error;
  }
  await assertNoSymlinkedLoopOutputAncestors(root, absolutePath);
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
