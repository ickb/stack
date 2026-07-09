import { createHash } from "node:crypto";
import fsPromises, {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as artifacts from "../../src/observability/artifacts.ts";
import { BotEventEmitter } from "../../src/observability/events.ts";
import { BOT_OBSERVABILITY_SUITE } from "./fixtures/observability.ts";

const artifactPrefix = "artifacts/slot-00";
const artifactKind = "bot.ringSegments";
const artifactDirectory = "ringSegments";
const artifactPayload = { ring: { totalPoolUdt: 1n, segments: [] } };
const artifactTempPrefix = "ickb-bot-artifact-";

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("writes content-addressed artifacts with hash filenames", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      await expectContentAddressedArtifact(artifactRoot);
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("normalizes unscoped artifact kinds into safe directories", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      const ref = await writeArtifact(artifactRoot, "ring/segments.v2", artifactPayload);

      expect(ref.path).toMatch(
        /^artifacts\/slot-00\/ring-segments-v2\/sha256-[\da-f]+\.json$/u,
      );
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("canonicalizes nested array artifact payloads", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      const ref = await writeArtifact(artifactRoot, artifactKind, {
        ring: {
          summary: { z: 2, a: 1 },
          rows: [[{ totalPoolUdt: 1n, nested: { z: 2, a: 1 } }]],
        },
      });
      const hash = ref.hash.slice("sha256:".length);

      await expect(readArtifactFile(artifactFilePath(artifactRoot, hash))).resolves.toBe(
        '{"kind":"bot.ringSegments","ring":{"rows":[[{"nested":{"a":1,"z":2},"totalPoolUdt":"1"}]],"summary":{"a":1,"z":2}},"version":1}\n',
      );
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("verifies existing artifact content before reusing a hash path", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      await expectExistingArtifactVerification(artifactRoot);
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("refuses symlinked artifact directories", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      await expectSymlinkedArtifactRefusal(artifactRoot);
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });
});

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("refuses non-file artifacts at existing content-addressed paths", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    try {
      const emitter = artifactEmitter(artifactRoot);
      const first = await emitter.writeArtifact(artifactKind, artifactPayload);
      const hash = first?.hash.slice("sha256:".length) ?? "";
      const artifactPath = artifactFilePath(artifactRoot, hash);
      await removeArtifactFile(artifactPath);
      await makeArtifactDirectory(artifactPath);

      await expect(emitter.writeArtifact(artifactKind, artifactPayload)).rejects.toThrow(
        /not a regular file/u,
      );
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("preserves successful artifact writes when temp cleanup fails", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    const rmSpy = vi
      .spyOn(fsPromises, "rm")
      .mockRejectedValueOnce(new Error("cleanup failed"));
    try {
      await expect(writeArtifact(artifactRoot, artifactKind, artifactPayload)).resolves
        .toMatchObject({ kind: artifactKind });
    } finally {
      rmSpy.mockRestore();
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("preserves earlier artifact errors when temp cleanup also fails", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    const linkSpy = vi
      .spyOn(fsPromises, "link")
      .mockRejectedValueOnce(new Error("link failed"));
    const rmSpy = vi
      .spyOn(fsPromises, "rm")
      .mockRejectedValueOnce(new Error("cleanup failed"));
    try {
      await expect(
        writeArtifact(artifactRoot, artifactKind, artifactPayload),
      ).rejects.toThrow(/link failed/u);
    } finally {
      linkSpy.mockRestore();
      rmSpy.mockRestore();
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("does not clean up a temp artifact when temp creation fails", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), artifactTempPrefix));
    const openSpy = vi
      .spyOn(fsPromises, "open")
      .mockRejectedValueOnce(new Error("open failed"));
    const rmSpy = vi.spyOn(fsPromises, "rm");
    try {
      await expect(
        writeArtifact(artifactRoot, artifactKind, artifactPayload),
      ).rejects.toThrow(/open failed/u);
      expect(rmSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      rmSpy.mockRestore();
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });
});

async function writeArtifact(
  artifactRoot: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<artifacts.BotArtifactRef> {
  return artifacts.writeBotArtifact({
    artifactRefPrefix: artifactPrefix,
    artifactRoot,
    kind,
    payload,
  });
}

async function expectContentAddressedArtifact(artifactRoot: string): Promise<void> {
  const emitter = artifactEmitter(artifactRoot);
  const ref = await emitter.writeArtifact(artifactKind, artifactPayload);

  if (ref === undefined) {
    throw new Error("expected artifact ref");
  }
  const hash = ref.hash.slice("sha256:".length);
  expect(ref).toMatchObject({
    kind: artifactKind,
    hash: `sha256:${hash}`,
    path: `${artifactPrefix}/${artifactDirectory}/sha256-${hash}.json`,
  });
  const artifactPath = artifactFilePath(artifactRoot, hash);
  const text = await readArtifactFile(artifactPath);
  expect(ref.hash).toBe(sha256Ref(text));
  expect(JSON.parse(text)).toEqual({
    kind: artifactKind,
    ring: { segments: [], totalPoolUdt: "1" },
    version: 1,
  });
  expect((await statArtifactFile(artifactPath)).mode & 0o777).toBe(0o600);
}

async function expectExistingArtifactVerification(artifactRoot: string): Promise<void> {
  const emitter = artifactEmitter(artifactRoot);
  const first = await emitter.writeArtifact(artifactKind, artifactPayload);
  const second = await emitter.writeArtifact(artifactKind, artifactPayload);
  expect(second).toEqual(first);

  const hash = first?.hash.slice("sha256:".length) ?? "";
  await writeArtifactFile(artifactFilePath(artifactRoot, hash), "wrong content\n");
  await expect(emitter.writeArtifact(artifactKind, artifactPayload)).rejects.toThrow(
    /content hash/u,
  );
  await expect(artifactTempFiles(artifactRoot)).resolves.toEqual([]);
}

async function expectSymlinkedArtifactRefusal(artifactRoot: string): Promise<void> {
  await makeArtifactDirectory(path.join(artifactRoot, "outside"));
  await makeArtifactSymlink(
    path.join(artifactRoot, "outside"),
    path.join(artifactRoot, artifactDirectory),
  );
  await expect(
    artifactEmitter(artifactRoot).writeArtifact(artifactKind, { ring: { segments: [] } }),
  ).rejects.toThrow(/symlinked artifact path/u);
}

function artifactEmitter(artifactRoot: string): BotEventEmitter {
  return new BotEventEmitter({
    artifactRefPrefix: artifactPrefix,
    artifactRoot,
    chain: "testnet",
    runId: "run-1",
  });
}

function artifactFilePath(artifactRoot: string, hash: string): string {
  return path.join(artifactRoot, artifactDirectory, `sha256-${hash}.json`);
}

async function readArtifactFile(artifactPath: string): Promise<string> {
  return readFile(artifactPath, "utf8");
}

async function statArtifactFile(artifactPath: string): Promise<{ mode: number }> {
  return stat(artifactPath);
}

async function writeArtifactFile(artifactPath: string, text: string): Promise<void> {
  await writeFile(artifactPath, text, { mode: 0o600 });
}

async function removeArtifactFile(artifactPath: string): Promise<void> {
  await unlink(artifactPath);
}

async function artifactTempFiles(artifactRoot: string): Promise<string[]> {
  const names = await readdir(path.join(artifactRoot, artifactDirectory));
  return names.filter((name) => name.includes(".tmp-"));
}

async function makeArtifactDirectory(directory: string): Promise<void> {
  await mkdir(directory);
}

async function makeArtifactSymlink(target: string, destination: string): Promise<void> {
  await symlink(target, destination, "dir");
}

function sha256Ref(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
