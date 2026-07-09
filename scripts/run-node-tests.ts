import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import pathModule from "node:path";
import process from "node:process";

const testRoot = "scripts/test";
const testFiles = recursiveFiles(testRoot, (name) => name.endsWith(".ts"));

if (testFiles.length === 0) {
  console.error("No Node script tests found.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}

function recursiveFiles(
  directory: string,
  predicate: (name: string) => boolean,
): string[] {
  if (!pathExists(directory)) {
    return [];
  }
  return readDirectory(directory)
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = pathModule.join(directory, entry.name);
      if (entry.isDirectory()) {
        return recursiveFiles(entryPath, predicate);
      }
      return entry.isFile() && predicate(entry.name) ? [entryPath] : [];
    });
}

function pathExists(filePath: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test discovery only scans the fixed scripts/test directory.
  return existsSync(filePath);
}

function readDirectory(filePath: string): Dirent[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test discovery only scans the fixed scripts/test directory.
  return readdirSync(filePath, { encoding: "utf8", withFileTypes: true });
}
