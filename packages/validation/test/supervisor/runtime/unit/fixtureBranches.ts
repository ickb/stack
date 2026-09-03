import type { ChildProcess } from "node:child_process";
import { expect, it } from "vitest";

import { assertNoSymlinkedConfigPath } from "../../../../src/supervisor/index.ts";
import {
  captureWrites,
  DIRECTORY_STATS,
  fakeChild,
  FakeChild,
  fakeHangingChild,
  ignoredChecker,
  jsonArtifact,
  lstatFixture,
  mkdirFixture,
  pathToString,
  recordAt,
  recursiveOption,
  selectiveIgnoredChecker,
  spawnFixture,
  stringArrayAt,
  stringifyJsonLine,
  SYMBOLIC_LINK_STATS,
} from "../../support/supervisor/index.ts";

it("covers exported support assertion and process fixture branches", async () => {
  const writes = new Map<string, string>();
  expect(() => jsonArtifact(writes, "/missing.json")).toThrow("Missing artifact");
  expect(() => recordAt([], "array")).toThrow("Expected record");
  expect(() => stringArrayAt(["ok", 1], "strings")).toThrow("Expected string array");
  expect(pathToString(Buffer.from("buffer"))).toBe("buffer");
  expect(pathToString(new URL("file:///tmp/test"))).toBe("file:///tmp/test");
  expect(() => pathToString(1)).toThrow("Unexpected artifact path type");

  const writeFile = captureWrites(writes).writeFile;
  if (writeFile === undefined) {
    throw new Error("Expected write fixture");
  }
  await writeFile(Buffer.from("/buffer-path"), Buffer.from("buffer-text"));
  expect(writes.get("/buffer-path")).toBe("buffer-text");
  expect(ignoredChecker(false)("git", [])).toMatchObject({ status: 1 });
  expect(selectiveIgnoredChecker(new Set())("git", [])).toMatchObject({ status: 1 });
  const spawned = spawnFixture((_command, args, options) =>
    fakeChild(`${String(args.length)}:${String(options.env?.["PATH"])}`),
  )("cmd");
  expect(spawned.kill()).toBe(true);
  await expect(
    lstatFixture((targetPath) =>
      String(targetPath).includes("link") ? SYMBOLIC_LINK_STATS : DIRECTORY_STATS,
    )(Buffer.from("/link")),
  ).resolves.toBe(SYMBOLIC_LINK_STATS);
  await expect(
    lstatFixture((targetPath) =>
      String(targetPath).includes("url") ? SYMBOLIC_LINK_STATS : DIRECTORY_STATS,
    )(new URL("file:///url")),
  ).resolves.toBe(SYMBOLIC_LINK_STATS);
  let mkdirRecursive: boolean | undefined;
  await mkdirFixture((_targetPath, options) => {
    mkdirRecursive = recursiveOption(options);
  })(new URL("file:///tmp/runtime-coverage"), { recursive: true });
  expect(mkdirRecursive).toBe(true);
  await expect(
    assertNoSymlinkedConfigPath("/repo", "/repo/config/bot.json", "config", {
      lstat: lstatFixture(() => DIRECTORY_STATS),
    }),
  ).resolves.toBeUndefined();
  await expect(
    assertNoSymlinkedConfigPath("/repo", "/repo/config/bot.json", "config", {
      lstat: lstatFixture(() => SYMBOLIC_LINK_STATS),
    }),
  ).rejects.toThrow("symlinked path");
  const child: ChildProcess = fakeHangingChild();
  expect(child.kill()).toBe(true);
  expect(child.kill("SIGKILL")).toBe(true);
  const baseChild = new FakeChild();
  expect(baseChild.kill()).toBe(true);
  expect(stringifyJsonLine({ ok: true })).toBe('{"ok":true}');
});
