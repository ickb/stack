import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactsDirectory,
  botEvent,
  botRebalanceEvaluated,
  canaryPrivateKey,
  collectBundle,
  collectIncident,
  commonArgs,
  fixtureDate,
  join,
  linkSymbolic,
  mkdirp,
  readIncidentSummary,
  readText,
  referencedArtifactEvents,
  referencedArtifactFixture,
  ringSegmentsArtifactPath,
  ringSegmentsDirectory,
  ringSegmentsKind,
  rm,
  rootDir,
  sha256Ref,
  slot00Directory,
  tempDir,
  windowSince,
  writeFixtureLogs,
  writeText,
} from "./support.ts";

void test("copies referenced bot diagnostic artifacts into incident bundles", async () => {
  const dir = await tempDir();
  try {
    const artifactText = '{"kind":"bot.ringSegments"}\n';
    const artifact = referencedArtifactFixture(artifactText);
    const logDir = await writeFixtureLogs(dir, {
      events: referencedArtifactEvents(artifact),
      launches: [],
      stderr: [],
    });
    const artifactPath = join(
      logDir,
      artifactsDirectory,
      slot00Directory,
      ringSegmentsDirectory,
      artifact.artifactFileName,
    );
    await mkdirp(
      join(logDir, artifactsDirectory, slot00Directory, ringSegmentsDirectory),
    );
    await writeText(artifactPath, artifactText, { mode: 0o600 });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    assert.equal(
      await readText(
        join(
          result.incidentDir,
          artifactsDirectory,
          slot00Directory,
          ringSegmentsDirectory,
          artifact.artifactFileName,
        ),
      ),
      artifactText,
    );
    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(summary.artifacts.included.length, 2);
    assert.deepEqual(summary.artifacts.missing, [
      {
        hash: `sha256:${"b".repeat(64)}`,
        kind: ringSegmentsKind,
        path: ringSegmentsArtifactPath(
          "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json",
        ),
      },
    ]);
    assert.deepEqual(summary.artifacts.mismatched, []);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("refuses referenced artifacts through symlinked parents", async () => {
  const dir = await tempDir();
  try {
    const artifactText = `${canaryPrivateKey}\n`;
    const artifactHash = sha256Ref(artifactText);
    const artifactFileName = `sha256-${artifactHash.slice("sha256:".length)}.json`;
    const logDir = await writeFixtureLogs(dir, {
      events: [
        botEvent(windowSince, botRebalanceEvaluated, {
          rebalance: {
            diagnostics: {
              ring: {
                segmentsRef: {
                  kind: ringSegmentsKind,
                  hash: artifactHash,
                  path: ringSegmentsArtifactPath(artifactFileName),
                },
              },
            },
          },
        }),
      ],
      launches: [],
      stderr: [],
    });
    const outside = join(dir, "outside-artifacts");
    await mkdirp(outside);
    await writeText(join(outside, artifactFileName), artifactText, { mode: 0o600 });
    await mkdirp(join(logDir, artifactsDirectory, slot00Directory));
    await linkSymbolic(
      outside,
      join(logDir, artifactsDirectory, slot00Directory, ringSegmentsDirectory),
      "dir",
    );

    await assert.rejects(
      async () =>
        collectIncident({
          argv: commonArgs(dir),
          now: fixtureDate,
          root: rootDir,
        }),
      /symlinked artifact/u,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("reports mismatched referenced artifact hashes without bundling them", async () => {
  const dir = await tempDir();
  try {
    const expectedText = '{"kind":"bot.ringSegments","expected":true}\n';
    const actualText = '{"kind":"bot.ringSegments","actual":true}\n';
    const expectedHash = sha256Ref(expectedText);
    const artifactFileName = `sha256-${expectedHash.slice("sha256:".length)}.json`;
    const artifactRef = {
      kind: ringSegmentsKind,
      hash: expectedHash,
      path: ringSegmentsArtifactPath(artifactFileName),
    };
    const logDir = await writeFixtureLogs(dir, {
      events: [
        botEvent(windowSince, botRebalanceEvaluated, {
          rebalance: { diagnostics: { ring: { segmentsRef: artifactRef } } },
        }),
      ],
      launches: [],
      stderr: [],
    });
    await mkdirp(
      join(logDir, artifactsDirectory, slot00Directory, ringSegmentsDirectory),
    );
    await writeText(
      join(
        logDir,
        artifactsDirectory,
        slot00Directory,
        ringSegmentsDirectory,
        artifactFileName,
      ),
      actualText,
      { mode: 0o600 },
    );

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    await assert.rejects(
      async () => readText(join(result.incidentDir, artifactRef.path)),
      /ENOENT/u,
    );
    const summary = await readIncidentSummary(result.incidentDir);
    assert.deepEqual(summary.artifacts.missing, []);
    assert.deepEqual(summary.artifacts.mismatched, [
      { ...artifactRef, actualHash: sha256Ref(actualText) },
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("reports conflicting artifact hashes that reuse one path", async () => {
  const dir = await tempDir();
  try {
    const artifactText = '{"kind":"bot.ringSegments","actual":true}\n';
    const artifactHash = sha256Ref(artifactText);
    const wrongHash = `sha256:${"c".repeat(64)}`;
    const artifactFileName = `sha256-${artifactHash.slice("sha256:".length)}.json`;
    const artifactPath = ringSegmentsArtifactPath(artifactFileName);
    const logDir = await writeFixtureLogs(dir, {
      events: [
        botEvent(windowSince, botRebalanceEvaluated, {
          rebalance: {
            diagnostics: {
              ring: {
                refs: [
                  { kind: ringSegmentsKind, hash: artifactHash, path: artifactPath },
                  { kind: ringSegmentsKind, hash: wrongHash, path: artifactPath },
                ],
              },
            },
          },
        }),
      ],
      launches: [],
      stderr: [],
    });
    await mkdirp(
      join(logDir, artifactsDirectory, slot00Directory, ringSegmentsDirectory),
    );
    await writeText(join(logDir, artifactPath), artifactText, { mode: 0o600 });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(summary.artifacts.included.length, 2);
    assert.deepEqual(summary.artifacts.mismatched, [
      {
        kind: ringSegmentsKind,
        hash: wrongHash,
        path: artifactPath,
        actualHash: artifactHash,
      },
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
