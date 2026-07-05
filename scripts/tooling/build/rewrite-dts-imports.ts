import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const roots = check ? args.slice(1) : args;

if (roots.length === 0) {
  throw new Error(
    "Usage: node scripts/rewrite-dts-imports.ts [--check] <dist-dir> [...]",
  );
}

const changed: string[] = [];

for (const root of roots) {
  for (const file of await declarationFiles(root)) {
    const original = await readText(file);
    const rewritten = rewriteDeclarationImports(original);
    if (rewritten === original) {
      continue;
    }
    changed.push(file);
    if (!check) {
      await writeText(file, rewritten);
    }
  }
}

if (check && changed.length > 0) {
  throw new Error(`Declaration imports need rewriting:\n${changed.join("\n")}`);
}

async function declarationFiles(filePath: string): Promise<string[]> {
  const stats = await statPath(filePath);
  if (stats.isFile()) {
    return filePath.endsWith(".d.ts") ? [filePath] : [];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const entries = await readDirectory(filePath);
  const files: string[] = [];
  for (const entry of entries) {
    files.push(...(await declarationFiles(path.join(filePath, entry.name))));
  }
  return files;
}

async function readDirectory(filePath: string): Promise<Dirent[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI roots are explicit user-selected build output paths.
  return readdir(filePath, { encoding: "utf8", withFileTypes: true });
}

async function readText(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI roots are explicit user-selected build output paths.
  return readFile(filePath, "utf8");
}

async function statPath(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI roots are explicit user-selected build output paths.
  return stat(filePath);
}

async function writeText(filePath: string, data: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI roots are explicit user-selected build output paths.
  await writeFile(filePath, data);
}

function rewriteDeclarationImports(source: string): string {
  return source
    .replaceAll(/\b(from\s+)(["'])(\.{1,2}\/[^"'\n]*?)\.ts\2/gu, replaceSpecifier)
    .replaceAll(/\b(import\s*\(\s*)(["'])(\.{1,2}\/[^"'\n]*?)\.ts\2/gu, replaceSpecifier)
    .replaceAll(/\b(import\s+)(["'])(\.{1,2}\/[^"'\n]*?)\.ts\2/gu, replaceSpecifier);
}

function replaceSpecifier(
  match: string,
  prefix: string,
  quote: string,
  specifier: string,
): string {
  return specifier.endsWith(".d") ? match : `${prefix}${quote}${specifier}.js${quote}`;
}
