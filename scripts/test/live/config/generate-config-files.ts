import assert from "node:assert/strict";
import {
  access,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  symlink as fsSymlink,
  mkdtemp,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import pathModule from "node:path";
import test from "node:test";
import { runGenerateConfig } from "../../../live/config/generate-config.ts";

const { join } = pathModule;
const configOut = "config/bot-testnet.json";
const tempPrefix = "ickb-generate-config-";
const rpcArgs = ["--rpc-url", "https://testnet.example/"] as const;

void test("config generator refuses symlinked output paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    await makeDir(join(dir, "target"));
    await makeSymlink(join(dir, "target"), join(dir, "config"));

    await assert.rejects(
      async () =>
        runGenerateConfig({
          argv: [...rpcArgs, "--out", configOut],
          root: dir,
          dependencies: {
            checkIgnored: () => true,
          },
        }),
      /symlinked parent directory/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("config generator creates exclusive owner-only output", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    await runGenerateConfig({
      argv: [...rpcArgs, "--out", configOut],
      root: dir,
      dependencies: {
        checkIgnored: () => true,
        randomBytes: () => Buffer.from("44".repeat(32), "hex"),
      },
    });

    const output = join(dir, configOut);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await assert.rejects(
      runGenerateConfig({
        argv: [...rpcArgs, "--out", configOut],
        root: dir,
        dependencies: { checkIgnored: () => true },
      }),
      /already exists/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("config generator checks existing ancestors before creating missing parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  const mkdirCalls: string[] = [];
  try {
    await runGenerateConfig({
      argv: [...rpcArgs, "--out", "config/nested/bot-testnet.json"],
      root: dir,
      dependencies: {
        checkIgnored: () => true,
        randomBytes: () => Buffer.from("55".repeat(32), "hex"),
        mkdir: async (filePath, options) => {
          mkdirCalls.push(filePath);
          await fsMkdir(filePath, options);
        },
      },
    });

    assert.deepEqual(
      mkdirCalls.map((path) => path.slice(dir.length + 1)),
      ["config", "config/nested"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("config generator removes staged config when final install fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    await assert.rejects(
      async () =>
        runGenerateConfig({
          argv: [...rpcArgs, "--out", configOut],
          root: dir,
          dependencies: {
            checkIgnored: () => true,
            randomBytes: () => Buffer.from("66".repeat(32), "hex"),
            link: () => {
              throw new Error("link failed");
            },
          },
        }),
      /link failed/u,
    );

    const configNames = await readdir(join(dir, "config"));
    assert.deepEqual(
      configNames.filter((name) => name.includes(".tmp-")),
      [],
    );
    await assert.rejects(access(join(dir, configOut)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("config generator accepts absolute outputs through a symlinked repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-generate-config-root-"));
  const realRoot = join(dir, "real");
  const symlinkRoot = join(dir, "link");
  try {
    await makeDir(realRoot);
    await makeSymlink(realRoot, symlinkRoot);

    const result = await runGenerateConfig({
      argv: [...rpcArgs, "--out", join(symlinkRoot, "config", "bot-testnet.json")],
      root: symlinkRoot,
      dependencies: {
        randomBytes: () => Buffer.from("77".repeat(32), "hex"),
        checkIgnored: (_root, relativePath) => relativePath.startsWith("config/"),
      },
    });

    assert("outputPath" in result);
    assert.equal(result.outputPath, "config/bot-testnet.json");
    assert.deepEqual(JSON.parse(await readText(join(realRoot, configOut))), {
      chain: "testnet",
      privateKey: `0x${"77".repeat(32)}`,
      rpcUrl: "https://testnet.example/",
      sleepIntervalSeconds: 60,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    });

    await assert.rejects(
      async () =>
        runGenerateConfig({
          argv: [...rpcArgs, "--out", join(dir, "outside.json")],
          root: symlinkRoot,
          dependencies: {
            randomBytes: () => Buffer.from("88".repeat(32), "hex"),
            checkIgnored: () => true,
          },
        }),
      /Output path must stay inside the repo/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeDir(filePath: string): Promise<void> {
  await fsMkdir(filePath);
}

async function makeSymlink(target: string, filePath: string): Promise<void> {
  await fsSymlink(target, filePath, "dir");
}

async function readText(filePath: string): Promise<string> {
  return fsReadFile(filePath, "utf8");
}
