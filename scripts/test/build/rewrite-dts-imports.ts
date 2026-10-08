import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { join } = path;
const rootDir = join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = join(rootDir, "scripts", "tooling", "build", "rewrite-dts-imports.ts");

void test("rewrite-dts-imports rewrites relative .ts declaration specifiers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rewrite-dts-imports-"));
  try {
    const file = join(dir, "index.d.ts");
    await writeText(
      file,
      [
        'export * from "./sdk.ts";',
        "import type { Cell } from '../cells.ts';",
        "type Lazy = import('./lazy.ts').Lazy;",
        "import './side-effect.ts';",
        "export * from './already.d.ts';",
        "export * from '@scope/pkg.ts';",
        "",
      ].join("\n"),
    );

    const checkBefore = run("--check", dir);
    assert.equal(checkBefore.status, 1);
    assert.match(checkBefore.stderr, /Declaration imports need rewriting/u);

    const rewrite = run(dir);
    assert.equal(rewrite.status, 0, rewrite.stderr);
    assert.equal(
      await readText(file),
      [
        'export * from "./sdk.js";',
        "import type { Cell } from '../cells.js';",
        "type Lazy = import('./lazy.js').Lazy;",
        "import './side-effect.js';",
        "export * from './already.d.ts';",
        "export * from '@scope/pkg.ts';",
        "",
      ].join("\n"),
    );

    const checkAfter = run("--check", dir);
    assert.equal(checkAfter.status, 0, checkAfter.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}

async function writeText(filePath: string, data: string): Promise<void> {
  await fsWriteFile(filePath, data);
}

function run(...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}
