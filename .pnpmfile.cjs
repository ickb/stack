// .pnpmfile.cjs — Two jobs:
//
// 1. Auto-replay: clone + patch managed forks on first `pnpm install` (if pins exist).
//    replay.sh handles git clone, merge replay, lockfile removal, and source
//    patching (jq exports rewrite). It does NOT run pnpm install
//    internally — the root workspace install handles fork deps alongside
//    everything else.
//
// 2. readPackage hook: rewrite fork deps from catalog ranges to workspace:*.
//    Fork packages live in pnpm-workspace.yaml, so you'd expect pnpm to link
//    them automatically. It doesn't — catalog: specifiers resolve to a semver
//    range (e.g. ^1.12.2) BEFORE workspace linking is considered, so pnpm
//    fetches from the registry even with link-workspace-packages = true.
//    This hook intercepts every package.json at resolution time and forces
//    workspace:* for any dep whose name matches a local fork package.
//    When no forks are cloned, the hook is a no-op, so catalog ranges fall
//    through to the registry normally.

const { execSync } = require("child_process");
const { existsSync, readdirSync, readFileSync } = require("fs");
const { join } = require("path");

// Discover all *-fork/ directories with config.json
const forkDirs = [];
for (const entry of readdirSync(__dirname, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.endsWith("-fork")) continue;
  const configPath = join(__dirname, entry.name, "config.json");
  if (existsSync(configPath)) {
    forkDirs.push({
      name: entry.name,
      dir: join(__dirname, entry.name),
      config: JSON.parse(readFileSync(configPath, "utf8")),
    });
  }
}

// 1. Auto-replay fork pins on first pnpm install
//    Skip when fork:record is running — it rebuilds pins from scratch.
//    Detect via argv since pnpmfile loads before npm_lifecycle_event is set.
const isRecord = process.argv.some((a) => a === "fork:record");
if (!isRecord) {
  for (const fork of forkDirs) {
    const cloneDir = join(fork.dir, fork.config.cloneDir);
    const hasPins = existsSync(join(fork.dir, "pins", "manifest"));
    if (!existsSync(cloneDir) && hasPins) {
      try {
        execSync(`bash fork-scripts/replay.sh ${fork.name}`, {
          cwd: __dirname,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        process.stderr.write(`Replaying ${fork.name} pins…\n`);
        process.stderr.write(err.stdout?.toString() ?? "");
        process.stderr.write(err.stderr?.toString() ?? "");
        throw err;
      }
    }
  }
}

// 2. Discover local fork packages and build the override map
const localOverrides = {};
for (const fork of forkDirs) {
  const cloneDir = join(fork.dir, fork.config.cloneDir);
  if (!existsSync(cloneDir)) continue;
  const includes = fork.config.workspace?.include ?? [];
  const excludes = new Set(fork.config.workspace?.exclude ?? []);
  for (const pattern of includes) {
    // Simple glob: only supports trailing /* (e.g. "packages/*")
    const base = pattern.replace(/\/\*$/, "");
    const pkgsRoot = join(cloneDir, base);
    if (!existsSync(pkgsRoot)) continue;
    for (const dir of readdirSync(pkgsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const relPath = `${base}/${dir.name}`;
      if (excludes.has(relPath)) continue;
      const pkgJsonPath = join(pkgsRoot, dir.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const { name } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      if (name) {
        localOverrides[name] = "workspace:*";
      }
    }
  }
}

const hasOverrides = Object.keys(localOverrides).length > 0;

function readPackage(pkg) {
  if (!hasOverrides) return pkg;

  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    if (!pkg[field]) continue;
    for (const [name, linkSpec] of Object.entries(localOverrides)) {
      if (pkg[field][name]) {
        pkg[field][name] = linkSpec;
      }
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
