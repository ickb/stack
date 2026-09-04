import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstSymlinkInPath, minimalProcessEnv } from "../src/index.ts";

const { join } = path;

describe("minimal child environment", () => {
  it("forwards only the allowlisted variables", () => {
    expect(minimalProcessEnv({ PATH: "/bin", PRIVATE_KEY: "secret" })).toEqual({
      PATH: "/bin",
    });
  });
});

describe("symlink path traversal", () => {
  it("finds symlinks and accepts missing descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "ickb-node-path-"));
    try {
      const target = join(root, "target");
      const linked = join(root, "linked");
      await mkdir(target);
      await symlink(target, linked, "dir");

      await expect(firstSymlinkInPath(join(linked, "file"), root)).resolves.toBe(linked);
      await expect(
        firstSymlinkInPath(join(root, "missing", "file"), root),
      ).resolves.toBeUndefined();
      await expect(firstSymlinkInPath(target, root)).resolves.toBeUndefined();
      await expect(
        firstSymlinkInPath(join(root, "target", "file")),
      ).resolves.toBeUndefined();
      await writeFile(join(root, "plain"), "");
      await expect(
        firstSymlinkInPath(join(root, "plain", "child"), root),
      ).rejects.toThrow(/ENOTDIR/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
