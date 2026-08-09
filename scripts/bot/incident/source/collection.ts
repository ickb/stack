import pathModule from "node:path";

import type { SourceCollectionOptions, SourceCollectionResult } from "../model/types.ts";
import { discoverSourceFiles, sourcePath } from "./discovery.ts";
import { filterJsonSource, filterStderrSource } from "./filter.ts";
import { appendMissingSource, appendSourceResult } from "./summary.ts";

const { join } = pathModule;

export async function collectSources({
  dependencies,
  outputs,
  paths,
  summary,
  window,
}: SourceCollectionOptions): Promise<SourceCollectionResult> {
  let collectedSummary = summary;
  for (const source of await discoverSourceFiles(paths.logDir, dependencies)) {
    const filePath = sourcePath(paths.logDir, source);
    if (source.kind === "stderr") {
      const result = await filterStderrSource({
        dependencies,
        filePath,
        sourceName: source.name,
        window,
      });
      if (result === null) {
        collectedSummary = appendMissingSource(collectedSummary, source.output, filePath);
        continue;
      }

      collectedSummary = appendSourceResult(collectedSummary, source, filePath, result);
      outputs.set(source.output, result.text);
      continue;
    }

    const result = await filterJsonSource({
      dependencies,
      filePath,
      kind: source.kind,
      sourceName: source.name,
      summary: collectedSummary,
      window,
    });
    if (result === null) {
      collectedSummary = appendMissingSource(collectedSummary, source.output, filePath);
      continue;
    }

    collectedSummary = appendSourceResult(result.summary, source, filePath, result);
    outputs.set(source.output, result.text);
  }

  return { outputs, summary: collectedSummary };
}

export function incidentParent(logDir: string): string {
  return join(logDir, "incidents");
}
