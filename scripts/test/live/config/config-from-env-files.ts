import assert from "node:assert/strict";
import { access, link, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  absoluteConfigPath,
  botConfigFile,
  botConfigPath,
  botLiveConfigPath,
  botPrivateKey,
  botPrivateKeyEnv,
  checkConfigIgnored,
  configDir,
  expectedConfig,
  linkSymbolic,
  liveEnv,
  makeDirectory,
  neverIgnored,
  readJson,
  rootTempPrefix,
  runLiveConfig,
  tempPrefix,
  testerConfigFile,
  testerConfigPath,
  testerPrivateKeyEnv,
} from "./config-from-env-support.ts";

const { join } = path;

void test("live env config helper refuses non-ignored and existing outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    await assert.rejects(
      runLiveConfig(dir, { dependencies: { checkIgnored: neverIgnored } }),
      /Refusing to write non-ignored config path/u,
    );
    await runLiveConfig(dir);
    await assert.rejects(runLiveConfig(dir), /Config already exists/u);
    await runLiveConfig(dir, {
      argv: ["--force"],
      env: liveEnv({
        [botPrivateKeyEnv]: `0x${"33".repeat(32)}`,
        [testerPrivateKeyEnv]: `0x${"44".repeat(32)}`,
      }),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper removes staged and partially linked outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  let linkCount = 0;
  try {
    await assert.rejects(
      runLiveConfig(dir, {
        dependencies: {
          checkIgnored: checkConfigIgnored,
          link: async (from, to) => {
            linkCount += 1;
            if (linkCount === 2) {
              throw new Error("second link failed");
            }
            await link(from, to);
          },
        },
      }),
      /second link failed/u,
    );
    const names = await readdir(join(dir, configDir));
    assert.deepEqual(names, []);
    await assert.rejects(access(join(dir, botConfigPath)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper restores previous configs after forced replace failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  const testerPath = absoluteConfigPath(dir, testerConfigFile);
  try {
    await runLiveConfig(dir);
    await assert.rejects(
      runLiveConfig(dir, {
        argv: ["--force"],
        env: liveEnv({ [botPrivateKeyEnv]: `0x${"55".repeat(32)}` }),
        dependencies: {
          checkIgnored: checkConfigIgnored,
          rename: async (from, to) => {
            if (from.includes(".tmp-") && to === testerPath) {
              throw new Error("install failed");
            }
            await rename(from, to);
          },
        },
      }),
      /install failed/u,
    );
    assert.deepEqual(
      await readJson(absoluteConfigPath(dir, botConfigFile)),
      expectedConfig({
        privateKey: botPrivateKey,
        maxIterations: 1,
        maxRetryableAttempts: 10,
      }),
    );
    const names = await readdir(join(dir, configDir));
    assert.deepEqual(
      names.filter((name) => /\.(?:backup|tmp)-/u.test(name)),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper refuses symlinked output paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), tempPrefix));
  try {
    await makeDirectory(join(dir, "target"));
    await linkSymbolic(join(dir, "target"), join(dir, configDir));
    await assert.rejects(runLiveConfig(dir), /symlinked parent directory/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("live env config helper accepts absolute outputs through a symlinked repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), rootTempPrefix));
  const realRoot = join(dir, "real");
  const symlinkRoot = join(dir, "link");
  try {
    await makeDirectory(realRoot);
    await linkSymbolic(realRoot, symlinkRoot);
    const result = await runLiveConfig(symlinkRoot, {
      dependencies: { checkIgnored: checkConfigIgnored },
    });
    assert("written" in result);
    assert.deepEqual(
      result.written.map((entry) => entry.outputPath),
      [botConfigPath, testerConfigPath, botLiveConfigPath],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
