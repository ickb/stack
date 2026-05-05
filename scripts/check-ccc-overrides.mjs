import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const workspaceText = readFileSync(workspacePath, "utf8");
const overrides = parseOverrides(workspaceText);
const directCccDeps = collectDirectCccDeps(rootDir);

const problems = [];
for (const [name, consumers] of directCccDeps.entries()) {
  const override = overrides.get(name);
  if (override === undefined) {
    problems.push({
      name,
      reason: "missing root override",
      consumers,
    });
    continue;
  }
  if (override !== "workspace:*") {
    problems.push({
      name,
      reason: `override is ${override}, expected workspace:*`,
      consumers,
    });
  }
}

if (problems.length > 0) {
  console.error("Direct @ckb-ccc/* dependencies must be covered by root workspace overrides:");
  for (const problem of problems) {
    console.error(`- ${problem.name}: ${problem.reason}`);
    console.error(`  consumers: ${problem.consumers.join(", ")}`);
  }
  process.exit(1);
}

console.log(
  `Verified ${directCccDeps.size} direct @ckb-ccc/* dependencies against root overrides.`,
);

function collectDirectCccDeps(root) {
  const manifests = [join(root, "package.json")];
  for (const group of ["packages", "apps"]) {
    const groupDir = join(root, group);
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(groupDir, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      manifests.push(manifestPath);
    }
  }

  const deps = new Map();
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const label = relativeLabel(root, manifestPath);
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const depName of Object.keys(manifest[field] ?? {})) {
        if (!depName.startsWith("@ckb-ccc/")) continue;
        const consumers = deps.get(depName) ?? [];
        consumers.push(`${label} (${field})`);
        deps.set(depName, consumers);
      }
    }
  }
  return deps;
}

function parseOverrides(workspaceYaml) {
  const overrides = new Map();
  let inOverrides = false;
  for (const line of workspaceYaml.split(/\r?\n/u)) {
    if (!inOverrides) {
      if (line === "overrides:") inOverrides = true;
      continue;
    }
    if (/^\S/u.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(/^\s{2}"([^"]+)":\s*(\S.*?)\s*$/u);
    if (match) {
      overrides.set(match[1], match[2]);
    }
  }
  return overrides;
}

function relativeLabel(root, filePath) {
  return filePath.slice(root.length + 1, -"/package.json".length);
}
