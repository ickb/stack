import { spawnSync } from "node:child_process";
import pathModule from "node:path";

import { scriptVersion } from "../model/constants.ts";
import { isRecord } from "../model/text.ts";
import type { IncidentDependencies, VersionMetadata } from "../model/types.ts";
import { safeReadFile } from "./filesystem.ts";

const { join } = pathModule;

export async function buildVersionMetadata(
  root: string,
  dependencies: IncidentDependencies,
): Promise<VersionMetadata> {
  const [rootPackage, botPackage] = await Promise.all([
    readPackage(join(root, "package.json")),
    readPackage(join(root, "apps/bot/package.json")),
  ]);
  return {
    script: {
      name: "collect-incident.ts",
      version: scriptVersion,
    },
    nodeVersion: process.version,
    package: {
      packageManager: rootPackage?.["packageManager"] ?? null,
      private: rootPackage?.["private"] === true,
    },
    botPackage:
      botPackage === null
        ? null
        : {
            name: typeof botPackage["name"] === "string" ? botPackage["name"] : null,
            version:
              typeof botPackage["version"] === "string" ? botPackage["version"] : null,
          },
    gitCommit: readGitCommit(root, dependencies),
  };
}

async function readPackage(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await safeReadFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readGitCommit(root: string, dependencies: IncidentDependencies): string | null {
  try {
    const spawn = dependencies.spawnSync ?? spawnSync;
    const result = spawn("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.error !== undefined || result.status !== 0) {
      return null;
    }
    const stdout =
      typeof result.stdout === "string"
        ? result.stdout
        : Buffer.from(result.stdout).toString("utf8");
    const commit = stdout.trim();
    return commit === "" ? null : commit;
  } catch {
    return null;
  }
}
