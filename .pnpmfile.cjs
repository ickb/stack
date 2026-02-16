const { execSync } = require("child_process");
const { existsSync, readdirSync, readFileSync } = require("fs");
const { join } = require("path");

const cccCache = join(__dirname, "ccc-dev", "ccc");
const cccRefs = join(__dirname, "ccc-dev", "pins", "REFS");

// Auto-setup: replay CCC pins on first pnpm install if pins are committed
if (!existsSync(cccCache) && existsSync(cccRefs)) {
  execSync("bash ccc-dev/replay.sh", {
    stdio: "inherit",
    cwd: __dirname,
  });
}

const cccPkgs = join(cccCache, "packages");

// Auto-discover all CCC packages: scan ccc-dev/ccc/packages/*/package.json
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
