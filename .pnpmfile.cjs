// .pnpmfile.cjs — Two jobs:
//
// 1. Auto-replay: clone + patch CCC on first `pnpm install` (if pins exist).
//    replay.sh handles git clone, merge replay, lockfile removal, and source
//    patching (jq exports rewrite + @ts-nocheck). It does NOT run pnpm install
//    internally — the root workspace install handles CCC deps alongside
//    everything else.
//
// 2. readPackage hook: rewrite CCC deps from catalog ranges to workspace:*.
//    CCC packages live in pnpm-workspace.yaml, so you'd expect pnpm to link
//    them automatically. It doesn't — catalog: specifiers resolve to a semver
//    range (e.g. ^1.12.2) BEFORE workspace linking is considered, so pnpm
//    fetches from the registry even with link-workspace-packages = true.
//    This hook intercepts every package.json at resolution time and forces
//    workspace:* for any dep whose name matches a local CCC package.
//    When CCC is not cloned, hasCcc is false and the hook is a no-op, so
//    the catalog range falls through to the registry normally.

const { execSync } = require("child_process");
const { existsSync, readdirSync, readFileSync } = require("fs");
const { join } = require("path");

const cccCache = join(__dirname, "ccc-dev", "ccc");
const cccRefs = join(__dirname, "ccc-dev", "pins", "REFS");

// 1. Auto-replay CCC pins on first pnpm install
if (!existsSync(cccCache) && existsSync(cccRefs)) {
  try {
    execSync("bash ccc-dev/replay.sh", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    process.stderr.write("Replaying CCC pins…\n");
    process.stderr.write(err.stdout?.toString() ?? "");
    process.stderr.write(err.stderr?.toString() ?? "");
    throw err;
  }
}

// 2. Discover local CCC packages and build the override map
const cccPkgs = join(cccCache, "packages");
const localOverrides = {};
if (existsSync(cccPkgs)) {
  for (const dir of readdirSync(cccPkgs, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgJsonPath = join(cccPkgs, dir.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const { name } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (name) {
      localOverrides[name] = "workspace:*";
    }
  }
}

const hasCcc = Object.keys(localOverrides).length > 0;

function readPackage(pkg) {
  if (!hasCcc) return pkg;

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
