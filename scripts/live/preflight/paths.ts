import { realpath } from "node:fs/promises";
import path from "node:path";
import { firstSymlinkInPath } from "../../../packages/node-utils/src/index.ts";
import { defaultCheckIgnored, type CheckIgnored } from "../config/git.ts";

export interface ResolvedConfigPath {
  absolutePath: string;
  relativePath: string;
}

interface StatLike {
  isSymbolicLink: () => boolean;
}

export interface ConfigPathDependencies {
  lstat?: (path: string) => Promise<StatLike>;
  realpath?: (path: string) => Promise<string>;
}

export function resolveConfigPath(
  originalRoot: string,
  resolvedRoot: string,
  configPath: string,
  checkIgnored: CheckIgnored = defaultCheckIgnored,
): ResolvedConfigPath {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(resolvedRoot, configPath);
  const relativePath = path.relative(resolvedRoot, absolutePath);
  if (isInsideRelativePath(relativePath)) {
    if (!checkIgnored(resolvedRoot, relativePath)) {
      throw new Error(`Refusing to read non-ignored config path: ${relativePath}`);
    }
    return { absolutePath, relativePath };
  }
  if (path.isAbsolute(configPath)) {
    const originalRelativePath = path.relative(originalRoot, configPath);
    if (isInsideRelativePath(originalRelativePath)) {
      if (!checkIgnored(resolvedRoot, originalRelativePath)) {
        throw new Error(
          `Refusing to read non-ignored config path: ${originalRelativePath}`,
        );
      }
      return {
        absolutePath: path.resolve(resolvedRoot, originalRelativePath),
        relativePath: originalRelativePath,
      };
    }
  }
  throw new Error("Config path must stay inside the repo");
}

export async function assertReadableConfigPath(
  root: string,
  configPath: string,
  dependencies: ConfigPathDependencies = {},
): Promise<void> {
  const symlink = await firstSymlinkInPath(configPath, root, {
    ...(dependencies.lstat === undefined ? {} : { lstat: dependencies.lstat }),
  });
  if (symlink !== undefined) {
    if (symlink === configPath) {
      throw new Error("Refusing to read symlink config path");
    }
    throw new Error(
      `Refusing to read config through symlinked path: ${path.relative(root, symlink)}`,
    );
  }

  const resolvedPath = await (dependencies.realpath ?? realpath)(configPath);
  const relativePath = path.relative(root, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Config path must stay inside the repo");
  }
}

function isInsideRelativePath(relativePath: string): boolean {
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
