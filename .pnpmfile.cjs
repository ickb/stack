// .pnpmfile.cjs — Two jobs:
//
// 1. Auto-replay: bootstrap forker tool, then clone + patch managed forks on
//    first `pnpm install` (if pins exist). Reference-only entries (no pins,
//    empty refs) are shallow-cloned. replay.sh handles git clone, merge replay,
//    lockfile removal, and source patching (jq exports rewrite). It does NOT
//    run pnpm install internally — the root workspace install handles fork deps
//    alongside everything else.
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

const { execFileSync } = require("child_process");
const { existsSync, readdirSync, readFileSync, rmSync } = require("fs");
const { join } = require("path");

const forksDir = join(__dirname, "forks");
const configPath = join(forksDir, "config.json");

// Read unified config
let config = {};
if (existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, "utf8"));
}

// 1. Auto-replay fork pins on first pnpm install
//    Skip when record.sh is running — it rebuilds pins from scratch.
const isRecord = process.env.FORKER_RECORDING === "1";
if (!isRecord) {
  // Bootstrap forker tool: if forks/forker/ doesn't exist, clone it
  const forkerDir = join(forksDir, "forker");
  if (!existsSync(forkerDir) && config.forker) {
    const upstream = config.forker.upstream;
    if (upstream) {
      try {
        execFileSync("git", ["clone", "--depth", "1", upstream, forkerDir], {
          cwd: __dirname,
          stdio: ["ignore", "pipe", "pipe"],
        });
        // Apply any local patches for forker
        const forkerPinDir = join(forksDir, ".pin", "forker");
        if (existsSync(forkerPinDir)) {
          const patches = readdirSync(forkerPinDir)
            .filter((f) => f.startsWith("local-") && f.endsWith(".patch"))
            .sort();
          for (const patch of patches) {
            execFileSync(
              "git",
              ["apply", join(forkerPinDir, patch)],
              { cwd: forkerDir, stdio: ["ignore", "pipe", "pipe"] },
            );
          }
        }
      } catch (err) {
        // Clean up partial state so next install retries from scratch
        try {
          rmSync(forkerDir, { recursive: true, force: true });
        } catch {}
        process.stderr.write("Bootstrapping forker tool…\n");
        process.stderr.write(err.stdout?.toString() ?? "");
        process.stderr.write(err.stderr?.toString() ?? "");
        throw err;
      }
    }
  }

  // Replay/clone each entry
  for (const [name, entry] of Object.entries(config)) {
    if (name === "forker") continue; // already handled above
    const cloneDir = join(forksDir, name);
    const hasPins = existsSync(join(forksDir, ".pin", name, "manifest"));

    if (!existsSync(cloneDir)) {
      if (hasPins) {
        // Replay from pins using forker
        try {
          execFileSync(
            "bash",
            [join(forkerDir, "replay.sh"), name],
            { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (err) {
          process.stderr.write(`Replaying ${name} pins…\n`);
          process.stderr.write(err.stdout?.toString() ?? "");
          process.stderr.write(err.stderr?.toString() ?? "");
          throw err;
        }
      } else if (
        Array.isArray(entry.refs) &&
        entry.refs.length === 0 &&
        entry.upstream
      ) {
        // Reference-only entry: shallow clone
        try {
          execFileSync(
            "git",
            ["clone", "--depth", "1", entry.upstream, cloneDir],
            { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] },
          );
        } catch (err) {
          process.stderr.write(`Cloning ${name} (reference)…\n`);
          process.stderr.write(err.stdout?.toString() ?? "");
          process.stderr.write(err.stderr?.toString() ?? "");
          throw err;
        }
      }
    }
  }
}

// 2. Discover local fork packages and build the override map
const localOverrides = {};
for (const [name, entry] of Object.entries(config)) {
  const cloneDir = join(forksDir, name);
  if (!existsSync(cloneDir)) continue;
  const includes = entry.workspace?.include ?? [];
  const excludes = new Set(entry.workspace?.exclude ?? []);
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
      const { name: pkgName } = JSON.parse(
        readFileSync(pkgJsonPath, "utf8"),
      );
      if (pkgName) {
        localOverrides[pkgName] = "workspace:*";
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
