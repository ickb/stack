import { lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { testArgs } from "../../support/stimulus/liveBotStimulus.ts";
import {
  aggregateCounts,
  appendSupervisorEvent,
  parseArgs,
  prepareSession,
  readJson,
  readText,
  resolveSessionPaths,
  writeFinalSummary,
  writeText,
} from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import {
  assertContained,
  assertValidationSessionShape,
  boundedText,
  displayPath,
  findLastIndex,
  isAlreadyExistsError,
  isNotFoundError,
  minimalProcessEnv,
  now,
  optionalNumberField,
  publicErrorMessage,
  resolveConfiguredPath,
  sleepMs,
  type Dependencies,
} from "../../support/stimulus/liveBotStimulusSessionImports.ts";
import { errno, mapAppend, mapWrite, sessionPaths } from "./support.ts";

const { join } = path;
const OUTSIDE_REPO_PATH = "/outside/file";
const SYMBOLIC_LINK_STATS = lstatSync("/proc/self/exe");
const symbolicLinkLstat: NonNullable<Dependencies["lstat"]> = new Proxy(lstat, {
  async apply(): Promise<typeof SYMBOLIC_LINK_STATS> {
    await Promise.resolve();
    return SYMBOLIC_LINK_STATS;
  },
});

it("rejects malformed live stimulus CLI arguments", () => {
  const sparseArgv = Array.from<string>({ length: 1 });

  expect(parseArgs(["-h"]).help).toBe(true);
  expect(() => parseArgs(sparseArgv)).toThrow("Missing argument at index 0");
  expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument");
  expect(() => parseArgs(["--wait-seconds", "0"])).toThrow("expected a positive integer");
  expect(() => parseArgs(["--poll-seconds", "9007199254740992"])).toThrow(
    "expected a safe integer",
  );
  expect(() => parseArgs(["--tester-fee", "-1"])).toThrow("expected an unsigned integer");
  expect(() => parseArgs(["--log-root"])).toThrow("Missing value");
  expect(() => parseArgs(["--log-root", "--bot-live-config"])).toThrow("Missing value");
});

it("covers path and public utility edge behavior", async () => {
  const slept: number[] = [];

  expect(() => resolveConfiguredPath("", "/repo", "path")).toThrow("must not be empty");
  expect(resolveConfiguredPath(OUTSIDE_REPO_PATH, "/repo", "path")).toBe(
    OUTSIDE_REPO_PATH,
  );
  expect(() => {
    assertContained("/repo/log", "/repo/out", "candidate");
  }).toThrow("must stay under --log-root");
  expect(() => {
    assertValidationSessionShape("/repo/log", "/repo/log/not-validation/run");
  }).toThrow("--session-root must be");
  expect(displayPath("/repo", OUTSIDE_REPO_PATH)).toBe(OUTSIDE_REPO_PATH);

  await sleepMs(5, {
    sleep: async (ms) => {
      slept.push(ms);
      await Promise.resolve();
    },
  });
  await sleepMs(0, {});

  expect(slept).toEqual([5]);
  expect(isAlreadyExistsError({ code: "EEXIST" })).toBe(true);
  expect(isAlreadyExistsError("EEXIST")).toBe(false);
  expect(isNotFoundError({ code: "ENOENT" })).toBe(true);
  expect(now({})).toBeGreaterThan(0);
  expect(boundedText("abc", 4)).toBe("abc");
  expect(boundedText("abcdef", 3)).toBe("");
  expect(publicErrorMessage(new Error("clear"))).toBe("clear");
  expect(publicErrorMessage("plain")).toBe("plain");
  expect(publicErrorMessage({})).toBe("Unknown error");
  expect(findLastIndex(Array.from({ length: 1 }), () => true)).toBe(-1);
  expect(optionalNumberField({ count: 1 }, "count")).toEqual({ count: 1 });
  expect(optionalNumberField({}, "count")).toEqual({});
  expect(minimalProcessEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
});

it("bounds evidence excerpts by UTF-8 bytes without splitting code points", () => {
  const excerpt = boundedText(`a${"😀".repeat(3000)}b`, 4000);
  const [prefix] = excerpt.split("\n<truncated ");

  expect(Buffer.byteLength(excerpt, "utf8")).toBe(4000);
  expect(Buffer.byteLength(prefix ?? "", "utf8")).toBe(3977);
  expect(prefix).toBe(`a${"😀".repeat(994)}`);
  expect(excerpt).toContain("<truncated 8025 bytes>");
  expect(excerpt).not.toContain("�");
});

it("uses real artifact IO defaults and rejects non-object JSON", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-artifacts-"));
  const paths = sessionPaths(tmpRoot);

  await mkdir(paths.supervisorDir, { recursive: true });

  await appendSupervisorEvent(paths, { type: "default_append" }, { now: () => 0 });
  await writeText(paths, "plain.txt", "hello", {});
  await expect(readText(join(paths.sessionRoot, "plain.txt"), {})).resolves.toBe("hello");
  await expect(readJson(join(paths.sessionRoot, "plain.txt"), {})).rejects.toThrow(
    /not valid JSON|Unexpected token/u,
  );
  const arrayJsonPath = join(paths.sessionRoot, "array.json");

  await writeFile(arrayJsonPath, "[]");
  await expect(readJson(arrayJsonPath, {})).rejects.toThrow("is not a JSON object");

  const writes = new Map<string, string>();
  const appended = new Map<string, string>();
  const summary = await writeFinalSummary(
    paths,
    tmpRoot,
    testArgs({ sessionRoot: undefined, testerFee: undefined, testerFeeBase: undefined }),
    { status: "failed" },
    {
      now: () => 0,
      writeFile: mapWrite(writes),
      appendFile: mapAppend(appended),
    },
  );

  expect(summary).toMatchObject({ result: { status: "failed" } });
  expect(writes.get(paths.summaryPath)).toContain('"testerFee": null');
  expect(appended.get(join(paths.supervisorDir, "events.ndjson"))).toContain(
    "session_finished",
  );
  expect(aggregateCounts(undefined)).toEqual({});
  expect(aggregateCounts({ aggregateCounts: { ok: 1, unsafe: 1.5, text: "1" } })).toEqual(
    { ok: 1 },
  );
});

it("guards live stimulus session paths", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-stimulus-paths-"));
  const args = testArgs({ logRoot: tmpRoot, sessionRoot: undefined });
  const resolved = resolveSessionPaths(args, "/repo", { now: () => 1_700_000_000_000 });

  expect(resolved.sessionRoot).toContain("live-bot-stimulus-1700000000");
  await prepareSession(resolved, {});

  const existing = sessionPaths(tmpRoot, "exists");
  await expect(
    prepareSession(existing, {
      mkdir: async (targetPath) => {
        if (targetPath === existing.sessionRoot) {
          throw errno("exists", "EEXIST");
        }
        await Promise.resolve();
      },
      lstat: async () => {
        await Promise.resolve();
        throw errno("missing", "ENOENT");
      },
      realpath: async (targetPath) => {
        await Promise.resolve();
        return targetPath;
      },
    }),
  ).rejects.toThrow("already exists");

  const symlinked = sessionPaths(tmpRoot, "symlinked");
  await expect(
    prepareSession(symlinked, {
      mkdir,
      lstat: symbolicLinkLstat,
      realpath: async (targetPath) => {
        await Promise.resolve();
        return targetPath;
      },
    }),
  ).rejects.toThrow("Refusing to use log root through symlinked path");

  const broken = sessionPaths(tmpRoot, "broken");
  await expect(
    prepareSession(broken, {
      mkdir: async (targetPath) => {
        if (targetPath === broken.sessionRoot) {
          throw new Error("mkdir failed");
        }
        await Promise.resolve();
      },
      lstat: async () => {
        await Promise.resolve();
        throw errno("missing", "ENOENT");
      },
      realpath: async (targetPath) => {
        await Promise.resolve();
        return targetPath;
      },
    }),
  ).rejects.toThrow("mkdir failed");
});
