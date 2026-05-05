import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const targets = [
  {
    filter: "@ickb/utils",
    script:
      "const mod = await import('@ckb-ccc/core'); if (!('ccc' in mod)) throw new Error('Missing ccc namespace export from @ckb-ccc/core');",
  },
  {
    filter: "@ickb/core",
    script:
      "const mod = await import('@ckb-ccc/udt'); if (!('udt' in mod)) throw new Error('Missing udt namespace export from @ckb-ccc/udt');",
  },
  {
    filter: "interface",
    script:
      "const mod = await import('@ckb-ccc/ccc'); if (!('ccc' in mod) || !('JoyId' in mod) || !('Transaction' in mod)) throw new Error('Missing expected @ckb-ccc/ccc exports');",
  },
];

for (const target of targets) {
  // Run the import from the real consumer package so resolution matches
  // the downstream path we want to validate, not the repo root.
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      target.filter,
      "exec",
      "node",
      "--input-type=module",
      "-e",
      target.script,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
