const { existsSync, readdirSync, readFileSync } = require("fs");
const { join } = require("path");

const cccPkgs = join(__dirname, "ccc", "packages");

// Auto-discover all CCC packages: scan ccc/packages/*/package.json
const localOverrides = {};
if (existsSync(cccPkgs)) {
  for (const dir of readdirSync(cccPkgs, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pkgJsonPath = join(cccPkgs, dir.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const { name } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (name) {
      localOverrides[name] = `link:${join(cccPkgs, dir.name)}`;
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
