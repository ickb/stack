import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const requireFromCore = Module.createRequire(`${rootDir}/packages/sdk/package.json`);
const requireFromCccCore = Module.createRequire(
  requireFromCore.resolve("@ckb-ccc/core/package.json"),
);

interface ModuleLoadParent {
  filename?: string;
}
type ModuleLoadResult =
  bigint | boolean | number | object | string | symbol | null | undefined;
type ModuleLoad = (
  this: unknown,
  request: string,
  parent: ModuleLoadParent | undefined,
  isMain: boolean,
) => ModuleLoadResult;

async function importFromRoot(modulePath: string): Promise<void> {
  await import(pathToFileURL(`${rootDir}/${modulePath}`).href);
}

function isModuleLoad(value: unknown): value is ModuleLoad {
  return typeof value === "function";
}

function punycodeGuardLoad(originalLoad: ModuleLoad, requests: string[]): ModuleLoad {
  return function loadWithPunycodeGuard(
    this: unknown,
    request: string,
    parent: ModuleLoadParent | undefined,
    isMain: boolean,
  ): ModuleLoadResult {
    if (request === "punycode" || request === "node:punycode") {
      requests.push(parent?.filename ?? "<unknown>");
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

// eslint-disable-next-line sonarjs/assertions-in-tests -- Asserts via node:assert deepEqual on the collected punycode-require list; sonarjs does not track it through the loop.
void test("workspace packages import directly from TypeScript source", async () => {
  for (const modulePath of [
    "packages/sdk/src/index.ts",
    "packages/node-utils/src/index.ts",
    "packages/testkit/src/index.ts",
  ]) {
    await importFromRoot(modulePath);
  }
});

void test("native source imports do not load deprecated builtin punycode", async () => {
  const originalLoad: unknown = Reflect.get(Module, "_load");
  if (!isModuleLoad(originalLoad)) {
    throw new TypeError("Module._load is not available");
  }

  const requests: string[] = [];
  const loadWithPunycodeGuard = punycodeGuardLoad(originalLoad, requests);
  Reflect.set(Module, "_load", loadWithPunycodeGuard);

  try {
    await importFromRoot("packages/sdk/src/index.ts");
    requireFromCore("@ckb-ccc/core");
    requireFromCccCore("@joyid/ckb");
    await importFromRoot("packages/bot/src/index.ts");
    await importFromRoot("apps/sampler/src/sampler.ts");
  } finally {
    Reflect.set(Module, "_load", originalLoad);
  }

  assert.deepEqual(requests, []);
});

void test("Node app entrypoints run from TypeScript source and fail fast without config", () => {
  for (const [modulePath, envName] of [
    ["apps/bot/src/index.ts", "BOT_CHAIN"],
    ["apps/validation/src/tester.ts", "TESTER_CHAIN"],
  ] as const) {
    const result = spawnSync(process.execPath, [modulePath], {
      cwd: rootDir,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.includes(`Empty env ${envName}`), true, result.stderr);
  }
});

void test("local CLIs execute from source with native Node", () => {
  const cases: Array<[string, string]> = [
    ["scripts/live/preflight.ts", "Usage: node scripts/live/preflight.ts"],
  ];

  for (const [scriptPath, expected] of cases) {
    const env = { ...process.env, NODE_OPTIONS: "" };
    const result = spawnSync(
      process.execPath,
      ["--trace-deprecation", scriptPath, "--help"],
      {
        cwd: rootDir,
        encoding: "utf8",
        env,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(expected));
    assert.doesNotMatch(result.stderr, /DEP0040|node:punycode|`punycode`/u);
  }
});
