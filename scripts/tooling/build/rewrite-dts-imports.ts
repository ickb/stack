import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  throw new Error("Usage: node scripts/rewrite-dts-imports.ts <dist-dir> [...]");
}

for (const root of roots) {
  for (const file of await declarationFiles(root)) {
    const original = await readFile(file, "utf8");
    const rewritten = rewriteDeclarationImports(original);
    if (rewritten !== original) {
      await writeFile(file, rewritten);
    }
  }
}

async function declarationFiles(root: string): Promise<string[]> {
  const names = await readdir(root, { recursive: true });
  return names
    .filter((name) => name.endsWith(".d.ts"))
    .map((name) => path.join(root, name));
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
