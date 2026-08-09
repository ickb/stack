import { minimalProcessEnv, ProcessSignalError } from "@ickb/node-utils";
import pathModule from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Dependencies } from "./liveBotStimulusTypes.ts";
const { isAbsolute, relative, resolve, sep } = pathModule;

export function resolveConfiguredPath(
  value: string,
  root: string,
  label: string,
): string {
  if (value === "") {
    throw new Error(`${label} must not be empty`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

export function assertContained(root: string, candidate: string, label: string): void {
  const relationship = relative(root, candidate);
  if (
    relationship === "" ||
    (!relationship.startsWith("..") && !isAbsolute(relationship))
  ) {
    return;
  }
  throw new Error(`${label} must stay under --log-root`);
}

export function assertValidationSessionShape(logRoot: string, sessionRoot: string): void {
  const parts = relative(logRoot, sessionRoot)
    .split(sep)
    .filter((part) => part !== "");
  if (parts.length === 2 && parts[0] === "validation") {
    return;
  }
  throw new Error("--session-root must be <log-root>/validation/<session>");
}

export function displayPath(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath.startsWith("..") || isAbsolute(relativePath) ? path : relativePath;
}

export function isoNow(dependencies: Dependencies): string {
  return new Date(now(dependencies)).toISOString();
}

export async function sleepMs(ms: number, dependencies: Dependencies): Promise<void> {
  if (dependencies.sleep !== undefined) {
    await dependencies.sleep(ms);
    return;
  }
  await sleep(ms);
}

export function optionalStringField(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = stringField(record, key);
  return value === undefined ? {} : { [key]: value };
}

export function optionalNumberField(
  record: Record<string, unknown>,
  key: string,
): Record<string, number> {
  const value = numberField(record, key);
  return value === undefined ? {} : { [key]: value };
}

export function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

export function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

export function isAlreadyExistsError(error: unknown): boolean {
  return isRecord(error) && error["code"] === "EEXIST";
}

export function now(dependencies: Dependencies): number {
  return dependencies.now?.() ?? Date.now();
}

export function throwIfInterrupted(dependencies: Dependencies): void {
  const signal = dependencies.receivedSignal?.();
  if (signal !== undefined) {
    throw new ProcessSignalError(signal);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { minimalProcessEnv };

export function publicErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

export function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }
  return -1;
}
