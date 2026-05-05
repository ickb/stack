import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const forksDir = join(rootDir, "forks");
const configPath = join(forksDir, "config.json");
const stageDir = join(forksDir, ".stage");
const stagePrefix = join(stageDir, "bootstrap-phroi_forker.");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const upstream = config.phroi_forker?.upstream;

if (typeof upstream !== "string" || upstream.length === 0) {
  throw new Error("forks/config.json must define phroi_forker.upstream");
}

// Bootstrap from a temporary forker checkout so plain stack checkouts do not
// need an existing local tool clone before materializing forks/.
mkdirSync(stageDir, { recursive: true });
const tempDir = mkdtempSync(stagePrefix);

try {
  const toolDir = join(tempDir, "repo");
  run("git", ["clone", "--filter=blob:none", "--depth", "1", upstream, toolDir]);
  run("bash", [join(toolDir, "materialize-workspace.sh")]);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
