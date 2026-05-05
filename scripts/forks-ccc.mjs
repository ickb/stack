import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cccDir = join(rootDir, "forks", "ccc", "repo");
const json = process.argv.includes("--json");
const planOnly = json || process.argv.includes("--plan");
const watch = process.argv.includes("--watch");
const watchCommand =
  "test -f misc/basedirs/dist/package.json && mkdir -p dist && cp misc/basedirs/dist/package.json dist/package.json; rm -rf dist.commonjs; exec tsc --watch --incremental false --preserveWatchOutput --rootDir src";

if (!existsSync(join(cccDir, "package.json"))) {
  console.error("Missing forks/ccc/repo. Run pnpm forks:bootstrap first.");
  process.exit(1);
}

const directDeps = collectDirectCccDeps(rootDir);
const directRoots = [...directDeps.keys()].sort();
if (directRoots.length === 0) {
  console.error("No direct @ckb-ccc/* dependencies found in the stack workspace.");
  process.exit(1);
}

const cccPackages = collectCccPackages(cccDir);
const buildSurface = [...collectClosure(directRoots, directDeps, cccPackages)].sort();
const watchSurface = buildSurface.filter((name) => isTscWatchPackage(cccPackages.get(name)));
const prebuildSurface = buildSurface.filter((name) => !watchSurface.includes(name));
const plan = {
  roots: directRoots,
  buildSurface,
  watchSurface,
  prebuildSurface,
};

if (planOnly) {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printPlan(plan, { includeWatchSurface: true });
  }
  process.exit(0);
}

printPlan(plan, { includeWatchSurface: watch });

if (watch) {
  if (prebuildSurface.length > 0) {
    runPnpm([...packageFilters(prebuildSurface), "run", "build"]);
  }

  runWatch(watchSurface);
} else {
  runPnpm([...packageFilters(buildSurface), "run", "build"]);
  cleanupTsBuildInfo(watchSurface, cccPackages);
}

function printPlan(plan, { includeWatchSurface }) {
  console.log(`CCC roots (${plan.roots.length}): ${plan.roots.join(", ")}`);
  console.log(
    `CCC build surface (${plan.buildSurface.length}): ${plan.buildSurface.join(", ")}`,
  );
  if (!includeWatchSurface) return;
  console.log(
    `CCC watch prebuild-only surface (${plan.prebuildSurface.length}): ${plan.prebuildSurface.join(", ")}`,
  );
  console.log(
    `CCC watch surface (${plan.watchSurface.length}): ${plan.watchSurface.join(", ")}`,
  );
}

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
    const manifest = readJson(manifestPath);
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const depName of Object.keys(manifest[field] ?? {})) {
        if (!depName.startsWith("@ckb-ccc/")) continue;
        const consumers = deps.get(depName) ?? [];
        consumers.push(manifestPath);
        deps.set(depName, consumers);
      }
    }
  }

  return deps;
}

function collectCccPackages(root) {
  const packagesDir = join(root, "packages");
  const packages = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    packages.set(manifest.name, {
      dir,
      manifest,
      buildScript: manifest.scripts?.build,
    });
  }
  return packages;
}

function collectClosure(roots, directDeps, cccPackages) {
  const closure = new Set();

  const visit = (packageName, consumer) => {
    if (closure.has(packageName)) return;

    const pkg = cccPackages.get(packageName);
    if (!pkg) {
      const from = consumer ? ` required by ${consumer}` : "";
      throw new Error(`Missing local CCC package for ${packageName}${from}.`);
    }

    closure.add(packageName);
    for (const depName of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (!depName.startsWith("@ckb-ccc/")) continue;
      visit(depName, packageName);
    }
  };

  for (const root of roots) {
    visit(root, directDeps.get(root)?.[0]);
  }

  return closure;
}

function isTscWatchPackage(pkg) {
  return Boolean(pkg?.buildScript?.includes("tsc") && !pkg.buildScript.includes("tsdown"));
}

function packageFilters(packages) {
  return [
    "--dir",
    cccDir,
    "-r",
    ...packages.flatMap((name) => ["--filter", name]),
  ];
}

function runPnpm(args) {
  const result = spawnSync("pnpm", args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runWatch(packages) {
  const child = spawn(
    "pnpm",
    [
      "--dir",
      cccDir,
      "-r",
      "--parallel",
      ...packages.flatMap((name) => ["--filter", name]),
      "exec",
      "sh",
      "-c",
      watchCommand,
    ],
    {
      cwd: rootDir,
      detached: true,
      stdio: "inherit",
    },
  );

  const forwardSignal = (signal) => {
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    cleanupTsBuildInfo(watchSurface, cccPackages);
    process.exit(code ?? signalExitCode(signal));
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function cleanupTsBuildInfo(packages, cccPackages) {
  for (const name of packages) {
    rmSync(join(cccPackages.get(name).dir, "tsconfig.tsbuildinfo"), {
      force: true,
    });
  }
}

function signalExitCode(signal) {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}
