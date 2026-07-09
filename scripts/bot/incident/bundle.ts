import pathModule from "node:path";

import {
  assertRealDirectory,
  prepareIncidentDirectory,
  writeBundleOutputs,
} from "./io/filesystem.ts";
import { buildVersionMetadata } from "./io/version.ts";
import { logDirectoryLabel } from "./model/constants.ts";
import type {
  CollectIncidentResult,
  IncidentDependencies,
  IncidentPaths,
  SourceWindow,
} from "./model/types.ts";
import { addReferencedArtifacts } from "./source/artifacts.ts";
import { collectSources, incidentParent } from "./source/collection.ts";
import { buildCompleteSummary, createSummary, incidentReadme } from "./source/summary.ts";

const { dirname } = pathModule;

export async function collectIncidentBundle({
  createdAt,
  dependencies,
  paths,
  root,
  window,
}: {
  createdAt: Date;
  dependencies: IncidentDependencies;
  paths: IncidentPaths;
  root: string;
  window: SourceWindow;
}): Promise<CollectIncidentResult> {
  await assertRealDirectory(paths.logRoot, "log root", dependencies);
  await assertRealDirectory(paths.logDir, logDirectoryLabel, dependencies);

  const summary = createSummary({
    createdAt,
    logDir: paths.logDir,
    logRoot: paths.logRoot,
    logRootSource: paths.logRootSource,
    since: window.since,
    until: window.until,
  });
  const collected = await collectSources({
    dependencies,
    outputs: new Map<string, string>(),
    paths,
    summary,
    window,
  });

  const version = await buildVersionMetadata(root, dependencies);
  collected.outputs.set("version.json", `${JSON.stringify(version, null, 2)}\n`);

  const artifactSummary = await addReferencedArtifacts(
    paths,
    collected.summary,
    collected.outputs,
    dependencies,
  );

  const completeSummary = buildCompleteSummary({
    createdAt,
    incidentParent: incidentParent(paths.logDir),
    summary: artifactSummary,
  });
  collected.outputs.set("README.txt", incidentReadme(completeSummary));
  collected.outputs.set("summary.json", `${JSON.stringify(completeSummary, null, 2)}\n`);

  await prepareIncidentDirectory(
    paths.logDir,
    dirname(completeSummary.incidentDir),
    completeSummary.incidentDir,
    dependencies,
  );
  await writeBundleOutputs(completeSummary.incidentDir, collected.outputs, dependencies);

  return {
    incidentDir: completeSummary.incidentDir,
    incidentId: completeSummary.incidentId,
    summary: completeSummary,
  };
}
