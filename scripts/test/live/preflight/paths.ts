import assert from "node:assert/strict";
import {
  mkdir as fsMkdir,
  symlink as fsSymlink,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runPreflight } from "../../../live/preflight/run.ts";
import { mockDependencies, randomPrivateKey } from "./support.ts";

const configFile = "config.json";
const targetConfigFile = "target.json";
const tempPrefix = "ickb-live-preflight-";

void test("preflight accepts absolute config paths through a symlinked repo root", async () => {
  const privateKey = randomPrivateKey();
  const dir = await mkdtemp(path.join(tmpdir(), "ickb-live-preflight-root-"));
  const realRoot = path.join(dir, "real");
  const symlinkRoot = path.join(dir, "link");
  try {
    await makeDirectory(realRoot);
    await linkSymbolic(realRoot, symlinkRoot, "dir");
    await writeText(
      path.join(realRoot, configFile),
      JSON.stringify(baseConfig(privateKey)),
    );

    const report = await runPreflight({
      configPath: path.join(symlinkRoot, configFile),
      root: symlinkRoot,
      dependencies: { ...mockDependencies(), checkIgnored: () => true },
    });

    assert.equal(report.chain, "testnet");
    await assert.rejects(
      async () =>
        runPreflight({
          configPath: path.join(dir, "outside.json"),
          root: symlinkRoot,
          dependencies: { ...mockDependencies(), checkIgnored: () => true },
        }),
      /Config path must stay inside the repo/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("preflight refuses non-ignored and out-of-repo config paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), tempPrefix));
  try {
    const configPath = path.join(dir, configFile);
    await writeText(configPath, JSON.stringify({}));

    await assert.rejects(
      async () =>
        runPreflight({
          configPath,
          root: dir,
          dependencies: { checkIgnored: () => false },
        }),
      /Refusing to read non-ignored config path: config\.json/u,
    );
    await assert.rejects(
      async () =>
        runPreflight({
          configPath: path.join(dir, "..", configFile),
          root: dir,
          dependencies: { checkIgnored: () => true },
        }),
      /Config path must stay inside the repo/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("preflight refuses symlink config paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), tempPrefix));
  try {
    await writeText(path.join(dir, targetConfigFile), JSON.stringify({}));
    const configPath = path.join(dir, configFile);
    await linkSymbolic(path.join(dir, targetConfigFile), configPath);

    await assert.rejects(
      async () =>
        runPreflight({
          configPath,
          root: dir,
          dependencies: { checkIgnored: () => true },
        }),
      /Refusing to read symlink config path/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("preflight refuses symlinked config parent paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), tempPrefix));
  try {
    await writeText(path.join(dir, targetConfigFile), JSON.stringify({}));
    await linkSymbolic(dir, path.join(dir, "config"), "dir");

    await assert.rejects(
      async () =>
        runPreflight({
          configPath: path.join(dir, "config", targetConfigFile),
          root: dir,
          dependencies: { checkIgnored: () => true },
        }),
      /Refusing to read config through symlinked path: config/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeDirectory(directory: string): Promise<void> {
  await fsMkdir(directory);
}

async function writeText(filePath: string, data: string): Promise<void> {
  await fsWriteFile(filePath, data);
}

async function linkSymbolic(
  target: string,
  linkPath: string,
  type?: "dir" | "file" | "junction",
): Promise<void> {
  await fsSymlink(target, linkPath, type);
}

function baseConfig(privateKey: string): {
  chain: string;
  privateKey: string;
  rpcUrl: string;
} {
  return {
    chain: "testnet",
    privateKey,
    rpcUrl: "https://testnet.example/",
  };
}
