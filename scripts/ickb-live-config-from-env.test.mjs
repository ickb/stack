import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildRuntimeConfig,
  parseArgs,
  runLiveConfigFromEnv,
  usage,
} from "./ickb-live-config-from-env.mjs";

const botPrivateKey = `0x${"11".repeat(32)}`;
const testerPrivateKey = `0x${"22".repeat(32)}`;

test("live env config helper parses CLI arguments", () => {
  assert.deepEqual(parseArgs([]), { force: false });
  assert.deepEqual(parseArgs(["--force"]), { force: true });
  assert.deepEqual(parseArgs(["--", "--help"]), { force: false, help: true });
  assert.throws(() => parseArgs(["--chain", "testnet"]), /Unknown argument/u);
  assert.match(usage(), /ICKB_TESTNET_BOT_PRIVATE_KEY/u);
  assert.match(usage(), /ICKB_TESTNET_RPC_URL/u);
  assert.match(usage(), /ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS/u);
});

test("live env config helper builds configs with optional RPC URL", () => {
  assert.deepEqual(buildRuntimeConfig({
    privateKey: botPrivateKey,
    rpcUrl: undefined,
    sleepIntervalSeconds: 1,
    maxIterations: undefined,
    maxRetryableAttempts: undefined,
  }), {
    chain: "testnet",
    privateKey: botPrivateKey,
    sleepIntervalSeconds: 1,
  });
  assert.deepEqual(buildRuntimeConfig({
    privateKey: botPrivateKey,
    rpcUrl: undefined,
    sleepIntervalSeconds: 1,
    maxIterations: 1,
    maxRetryableAttempts: 10,
  }), {
    chain: "testnet",
    privateKey: botPrivateKey,
    sleepIntervalSeconds: 1,
    maxIterations: 1,
    maxRetryableAttempts: 10,
  });
  assert.deepEqual(buildRuntimeConfig({
    privateKey: botPrivateKey,
    rpcUrl: "https://testnet.example/",
    sleepIntervalSeconds: 2,
    maxIterations: 3,
    maxRetryableAttempts: 4,
  }), {
    chain: "testnet",
    privateKey: botPrivateKey,
    rpcUrl: "https://testnet.example/",
    sleepIntervalSeconds: 2,
    maxIterations: 3,
    maxRetryableAttempts: 4,
  });
});

test("live env config helper writes both ignored testnet configs from env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  try {
    const result = await runLiveConfigFromEnv({
      argv: [],
      root: dir,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
      },
      dependencies: {
        checkIgnored: (_root, relativePath) => relativePath.startsWith("config/"),
      },
    });

    assert.deepEqual(result, {
      written: [
        {
          role: "bot",
          outputPath: "config/bot-testnet.json",
          chain: "testnet",
          rpcConfigured: false,
          sleepIntervalSeconds: 1,
          maxIterations: 1,
          maxRetryableAttempts: 10,
          privateKey: "<written-to-config-file>",
        },
        {
          role: "tester",
          outputPath: "config/tester-testnet.json",
          chain: "testnet",
          rpcConfigured: false,
          sleepIntervalSeconds: 1,
          maxIterations: 1,
          maxRetryableAttempts: 10,
          privateKey: "<written-to-config-file>",
        },
      ],
    });
    assert.doesNotMatch(JSON.stringify(result), /0x11|0x22/u);

    const botConfigPath = join(dir, "config", "bot-testnet.json");
    const testerConfigPath = join(dir, "config", "tester-testnet.json");
    assert.deepEqual(JSON.parse(await readFile(botConfigPath, "utf8")), {
      chain: "testnet",
      privateKey: botPrivateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    });
    assert.deepEqual(JSON.parse(await readFile(testerConfigPath, "utf8")), {
      chain: "testnet",
      privateKey: testerPrivateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    });
    assert.equal((await stat(botConfigPath)).mode & 0o777, 0o600);
    assert.equal((await stat(testerConfigPath)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper reports configured RPC URLs without exposing them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const written = [];
  const dirs = new Set([dir]);
  try {
    const result = await runLiveConfigFromEnv({
      argv: [],
      root: dir,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        ICKB_TESTNET_RPC_URL: "https://user:pass@testnet.example/path?token=secret",
        ICKB_TESTNET_SLEEP_INTERVAL_SECONDS: "10",
        ICKB_TESTNET_MAX_ITERATIONS: "2",
        ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS: "3",
      },
      dependencies: {
        checkIgnored: () => true,
        mkdir: async (path) => {
          dirs.add(path);
        },
        lstat: async (path) => {
          if (dirs.has(path)) {
            return { isSymbolicLink: () => false };
          }
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        realpath: async (path) => path,
        writeFile: async (path, text, options) => {
          written.push({ path, text, options });
        },
        link: async () => undefined,
        unlink: async () => undefined,
      },
    });

    assert.equal(written.length, 2);
    assert.deepEqual(written.map((entry) => entry.options), [
      { flag: "wx", mode: 0o600 },
      { flag: "wx", mode: 0o600 },
    ]);
    assert.deepEqual(written.map((entry) => JSON.parse(entry.text)), [
      {
        chain: "testnet",
        privateKey: botPrivateKey,
        rpcUrl: "https://user:pass@testnet.example/path?token=secret",
        sleepIntervalSeconds: 10,
        maxIterations: 2,
        maxRetryableAttempts: 3,
      },
      {
        chain: "testnet",
        privateKey: testerPrivateKey,
        rpcUrl: "https://user:pass@testnet.example/path?token=secret",
        sleepIntervalSeconds: 10,
        maxIterations: 2,
        maxRetryableAttempts: 3,
      },
    ]);
    assert.deepEqual(result.written.map((entry) => entry.rpcConfigured), [true, true]);
    assert.doesNotMatch(JSON.stringify(result), /0x11|0x22|user:pass|token=secret/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper validates env before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const writes = [];
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: { ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey },
        dependencies: {
          checkIgnored: () => true,
          writeFile: async () => {
            writes.push("write");
          },
          link: async () => undefined,
          unlink: async () => undefined,
        },
      }),
      /Missing env ICKB_TESTNET_TESTER_PRIVATE_KEY/u,
    );
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
          ICKB_TESTNET_RPC_URL: "",
        },
        dependencies: {
          checkIgnored: () => true,
          writeFile: async () => {
            writes.push("write");
          },
          link: async () => undefined,
          unlink: async () => undefined,
        },
      }),
      /Invalid env ICKB_TESTNET_RPC_URL/u,
    );
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
          ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS: "0",
        },
        dependencies: {
          checkIgnored: () => true,
          writeFile: async () => {
            writes.push("write");
          },
          link: async () => undefined,
          unlink: async () => undefined,
        },
      }),
      /Invalid env ICKB_TESTNET_MAX_RETRYABLE_ATTEMPTS/u,
    );
    assert.deepEqual(writes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper refuses non-ignored outputs and existing configs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: { checkIgnored: () => false },
      }),
      /Refusing to write non-ignored config path/u,
    );

    await runLiveConfigFromEnv({
      argv: [],
      root: dir,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
      },
      dependencies: { checkIgnored: () => true },
    });
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: { checkIgnored: () => true },
      }),
      /Config already exists/u,
    );
    await runLiveConfigFromEnv({
      argv: ["--force"],
      root: dir,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: `0x${"33".repeat(32)}`,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: `0x${"44".repeat(32)}`,
      },
      dependencies: { checkIgnored: () => true },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper opens output with no-follow and exclusive defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const opened = [];
  const dirs = new Set([dir]);
  try {
    await runLiveConfigFromEnv({
      argv: [],
      root: dir,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
      },
      dependencies: {
        checkIgnored: () => true,
        mkdir: async (path) => {
          dirs.add(path);
        },
        lstat: async (path) => {
          if (dirs.has(path)) {
            return { isSymbolicLink: () => false };
          }
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
        realpath: async (path) => path,
        open: async (path, flags, mode) => {
          opened.push({ path, flags, mode });
          return {
            writeFile: async () => undefined,
            chmod: async () => undefined,
            close: async () => undefined,
          };
        },
        link: async () => undefined,
        unlink: async () => undefined,
      },
    });

    assert.equal(opened.length, 2);
    for (const entry of opened) {
      assert.equal(entry.flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
      assert.equal(entry.flags & constants.O_EXCL, constants.O_EXCL);
      assert.equal(entry.mode, 0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper removes partial create outputs when pair commit fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const dirs = new Set([dir]);
  const linked = [];
  const unlinked = [];
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: {
          checkIgnored: () => true,
          mkdir: async (path) => {
            dirs.add(path);
          },
          lstat: async (path) => {
            if (dirs.has(path)) {
              return { isSymbolicLink: () => false };
            }
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          },
          realpath: async (path) => path,
          writeFile: async () => undefined,
          link: async (_from, to) => {
            if (linked.length === 1) {
              throw new Error("second link failed");
            }
            linked.push(to);
          },
          unlink: async (path) => {
            unlinked.push(path);
          },
        },
      }),
      /second link failed/u,
    );

    assert.equal(linked.length, 1);
    assert.match(linked[0], /config\/bot-testnet\.json$/u);
    assert(unlinked.includes(linked[0]));
    assert.equal(new Set(unlinked.filter((path) => /\.tmp-/u.test(path))).size, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper removes partial temp files when writes fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const dirs = new Set([dir]);
  const unlinked = [];
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: {
          checkIgnored: () => true,
          mkdir: async (path) => {
            dirs.add(path);
          },
          lstat: async (path) => {
            if (dirs.has(path)) {
              return { isSymbolicLink: () => false };
            }
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          },
          realpath: async (path) => path,
          open: async () => ({
            writeFile: async () => {
              throw new Error("write failed");
            },
            chmod: async () => undefined,
            close: async () => undefined,
          }),
          unlink: async (path) => {
            unlinked.push(path);
          },
        },
      }),
      /write failed/u,
    );

    assert.equal(unlinked.length, 1);
    assert.match(unlinked[0], /config\/bot-testnet\.json\.tmp-/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper restores previous configs when forced pair replace fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const botPath = join(dir, "config", "bot-testnet.json");
  const testerPath = join(dir, "config", "tester-testnet.json");
  const dirs = new Set([dir, join(dir, "config")]);
  const files = new Set([botPath, testerPath]);
  const renames = [];
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: ["--force"],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: {
          checkIgnored: () => true,
          mkdir: async (path) => {
            dirs.add(path);
          },
          lstat: async (path) => {
            if (dirs.has(path) || files.has(path)) {
              return { isSymbolicLink: () => false };
            }
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          },
          realpath: async (path) => path,
          writeFile: async (path) => {
            files.add(path);
          },
          rename: async (from, to) => {
            if (/\.tmp-/u.test(from) && to === testerPath) {
              throw new Error("second rename failed");
            }
            renames.push({ from, to });
            files.delete(from);
            files.add(to);
          },
          unlink: async (path) => {
            files.delete(path);
          },
        },
      }),
      /second rename failed/u,
    );

    assert(files.has(botPath));
    assert(files.has(testerPath));
    assert.equal([...files].filter((path) => /\.tmp-|\.backup-/u.test(path)).length, 0);
    assert(renames.some((entry) => entry.from === botPath && /bot-testnet\.json\.backup-/u.test(entry.to)));
    assert(renames.some((entry) => entry.from === testerPath && /tester-testnet\.json\.backup-/u.test(entry.to)));
    assert(renames.some((entry) => /bot-testnet\.json\.backup-/u.test(entry.from) && entry.to === botPath));
    assert(renames.some((entry) => /tester-testnet\.json\.backup-/u.test(entry.from) && entry.to === testerPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper continues restoring backups after one restore fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  const botPath = join(dir, "config", "bot-testnet.json");
  const testerPath = join(dir, "config", "tester-testnet.json");
  const dirs = new Set([dir, join(dir, "config")]);
  const files = new Set([botPath, testerPath]);
  const restoreAttempts = [];
  try {
    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: ["--force"],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: {
          checkIgnored: () => true,
          mkdir: async (path) => {
            dirs.add(path);
          },
          lstat: async (path) => {
            if (dirs.has(path) || files.has(path)) {
              return { isSymbolicLink: () => false };
            }
            const error = new Error("missing");
            error.code = "ENOENT";
            throw error;
          },
          realpath: async (path) => path,
          writeFile: async (path) => {
            files.add(path);
          },
          rename: async (from, to) => {
            if (/\.tmp-/u.test(from) && to === botPath) {
              throw new Error("install failed");
            }
            if (/\.backup-/u.test(from)) {
              restoreAttempts.push(to);
              if (to === testerPath) {
                throw new Error("restore failed");
              }
            }
            files.delete(from);
            files.add(to);
          },
          unlink: async (path) => {
            files.delete(path);
          },
        },
      }),
      /install failed/u,
    );

    assert.deepEqual(restoreAttempts, [testerPath, botPath]);
    assert(files.has(botPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper refuses symlinked output paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-"));
  try {
    await mkdir(join(dir, "target"));
    await symlink(join(dir, "target"), join(dir, "config"), "dir");

    await assert.rejects(
      () => runLiveConfigFromEnv({
        argv: [],
        root: dir,
        env: {
          ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
          ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
        },
        dependencies: { checkIgnored: () => true },
      }),
      /symlinked parent directory/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("live env config helper accepts absolute outputs through a symlinked repo root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ickb-live-config-env-root-"));
  const realRoot = join(dir, "real");
  const symlinkRoot = join(dir, "link");
  try {
    await mkdir(realRoot);
    await symlink(realRoot, symlinkRoot, "dir");

    const result = await runLiveConfigFromEnv({
      argv: [],
      root: symlinkRoot,
      env: {
        ICKB_TESTNET_BOT_PRIVATE_KEY: botPrivateKey,
        ICKB_TESTNET_TESTER_PRIVATE_KEY: testerPrivateKey,
      },
      dependencies: {
        checkIgnored: (_root, relativePath) => relativePath.startsWith("config/"),
      },
    });

    assert.deepEqual(result.written.map((entry) => entry.outputPath), [
      "config/bot-testnet.json",
      "config/tester-testnet.json",
    ]);
    assert.deepEqual(JSON.parse(await readFile(join(realRoot, "config", "bot-testnet.json"), "utf8")), {
      chain: "testnet",
      privateKey: botPrivateKey,
      sleepIntervalSeconds: 1,
      maxIterations: 1,
      maxRetryableAttempts: 10,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
