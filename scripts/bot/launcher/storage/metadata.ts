import path from "node:path";

import type { PackageInfo } from "../runtime/types.ts";
import { safeReadFile } from "./filesystem.ts";

export async function readBotPackageInfo(root: string): Promise<PackageInfo | null> {
  try {
    const text = await safeReadFile(path.join(root, "apps/bot/package.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isPackageJson(parsed)) {
      return { name: null, version: null };
    }
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      version: typeof parsed.version === "string" ? parsed.version : null,
    };
  } catch {
    return null;
  }
}

function isPackageJson(value: unknown): value is { name?: unknown; version?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
