import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cccDir = join(rootDir, "forks", "ccc", "repo");

test(
  "forks-ccc --json reports the current stack-owned CCC surfaces",
  { skip: !existsSync(join(cccDir, "package.json")) },
  () => {
    const result = spawnSync("node", ["scripts/forks-ccc.mjs", "--json"], {
      cwd: rootDir,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);

    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.roots, [
      "@ckb-ccc/ccc",
      "@ckb-ccc/core",
      "@ckb-ccc/udt",
    ]);
    assert.deepEqual(plan.buildSurface, [
      "@ckb-ccc/ccc",
      "@ckb-ccc/core",
      "@ckb-ccc/did-ckb",
      "@ckb-ccc/eip6963",
      "@ckb-ccc/joy-id",
      "@ckb-ccc/nip07",
      "@ckb-ccc/okx",
      "@ckb-ccc/rei",
      "@ckb-ccc/shell",
      "@ckb-ccc/spore",
      "@ckb-ccc/ssri",
      "@ckb-ccc/type-id",
      "@ckb-ccc/udt",
      "@ckb-ccc/uni-sat",
      "@ckb-ccc/utxo-global",
      "@ckb-ccc/xverse",
    ]);
    assert.deepEqual(plan.watchSurface, [
      "@ckb-ccc/ccc",
      "@ckb-ccc/core",
      "@ckb-ccc/eip6963",
      "@ckb-ccc/joy-id",
      "@ckb-ccc/nip07",
      "@ckb-ccc/okx",
      "@ckb-ccc/rei",
      "@ckb-ccc/shell",
      "@ckb-ccc/spore",
      "@ckb-ccc/ssri",
      "@ckb-ccc/udt",
      "@ckb-ccc/uni-sat",
      "@ckb-ccc/utxo-global",
      "@ckb-ccc/xverse",
    ]);
    assert.deepEqual(plan.prebuildSurface, [
      "@ckb-ccc/did-ckb",
      "@ckb-ccc/type-id",
    ]);
  },
);
