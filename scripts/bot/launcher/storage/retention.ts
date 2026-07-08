import path from "node:path";

import { launchLogFileName } from "../runtime/constants.ts";
import { isErrorCode } from "../runtime/support.ts";
import type { ManagedRunGroup } from "../runtime/types.ts";
import { safeLstat, safeReaddir, safeRm } from "./filesystem.ts";

export async function applyStorageQuota(
  logDir: string,
  currentSlotName: string,
  quotaBytes: number,
): Promise<void> {
  const groups = await managedRunGroups(logDir, currentSlotName);
  const launchesSize = await fileSize(path.join(logDir, launchLogFileName));
  let total = launchesSize + groups.reduce((sum, group) => sum + group.size, 0);
  for (const group of groups
    .filter((candidate) => candidate.slotName !== currentSlotName)
    .toSorted((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= quotaBytes) {
      break;
    }
    for (const item of group.items) {
      await pruneManagedRunItem(item);
    }
    total -= group.size;
  }
}

async function pruneManagedRunItem(
  item: ManagedRunGroup["items"][number],
): Promise<void> {
  try {
    await safeRm(item.path, { force: true, recursive: item.kind === "directory" });
  } catch {
    // Quota pruning is best-effort; failed cleanup must not block launcher startup.
  }
}

async function managedRunGroups(
  logDir: string,
  currentSlotName: string,
): Promise<ManagedRunGroup[]> {
  const groups = new Map<string, ManagedRunGroup>();
  const entries = await readOptionalDirectory(logDir);
  for (const entry of entries) {
    if (entry.isFile()) {
      await addManagedFileGroup(groups, logDir, entry.name);
    }
  }

  await addArtifactGroups(groups, logDir);
  ensureCurrentRunGroup(groups, currentSlotName);
  return [...groups.values()];
}

async function readOptionalDirectory(
  directory: string,
): Promise<Awaited<ReturnType<typeof safeReaddir>>> {
  try {
    return await safeReaddir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

async function addManagedFileGroup(
  groups: Map<string, ManagedRunGroup>,
  logDir: string,
  entryName: string,
): Promise<void> {
  const slotName = /^bot\.(?:events|stderr)\.(slot-\d{2})\.(?:ndjson|log)$/u.exec(
    entryName,
  )?.[1];
  if (slotName !== undefined) {
    await addManagedRunItem(groups, slotName, path.join(logDir, entryName));
  }
}

async function addArtifactGroups(
  groups: Map<string, ManagedRunGroup>,
  logDir: string,
): Promise<void> {
  const artifactDir = path.join(logDir, "artifacts");
  const artifactEntries = await readOptionalDirectory(artifactDir);
  for (const entry of artifactEntries) {
    if (/^slot-\d{2}$/u.test(entry.name)) {
      await addManagedRunItem(groups, entry.name, path.join(artifactDir, entry.name));
    }
  }
}

async function addManagedRunItem(
  groups: Map<string, ManagedRunGroup>,
  slotName: string,
  filePath: string,
): Promise<void> {
  const stat = await safeLstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked managed log path: ${filePath}`);
  }
  const isDirectory = stat.isDirectory();
  const size = isDirectory ? await directorySize(filePath) : stat.size;
  const group = groups.get(slotName) ?? {
    items: [],
    mtimeMs: 0,
    size: 0,
    slotName,
  };
  group.items.push({ kind: isDirectory ? "directory" : "file", path: filePath });
  group.mtimeMs = Math.max(group.mtimeMs, stat.mtimeMs);
  group.size += size;
  groups.set(slotName, group);
}

function ensureCurrentRunGroup(
  groups: Map<string, ManagedRunGroup>,
  currentSlotName: string,
): void {
  if (groups.has(currentSlotName)) {
    return;
  }
  groups.set(currentSlotName, {
    items: [],
    mtimeMs: 0,
    size: 0,
    slotName: currentSlotName,
  });
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await safeLstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked managed log path: ${filePath}`);
    }
    return stat.isFile() ? stat.size : 0;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return 0;
    }
    throw error;
  }
}

async function directorySize(directory: string): Promise<number> {
  const entries = await safeReaddir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    const stat = await safeLstat(child);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked managed log path: ${child}`);
    }
    total += stat.isDirectory() ? await directorySize(child) : stat.size;
  }
  return total;
}
