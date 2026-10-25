// Fails when the pinned Node major has a newer release that the Node project flags as a
// security release and that is old enough to trust. Nothing else audits the runtime:
// pnpm outdated does not report devEngines, and the resolver applies no release age to it.
import { readFile } from "node:fs/promises";

// Three days: long enough for a pulled or regressed release to show (user decision 2026-10-25).
const ACCEPTANCE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const cutoff = Date.now() - ACCEPTANCE_AGE_MS;
const problems: string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function text(value: unknown, key: string): string {
  const found = isRecord(value) ? value[key] : undefined;
  if (typeof found === "string") {
    return found;
  }
  throw new TypeError(`${key} is not a string`);
}

const parseVersion = (version: string): number[] =>
  version.replace(/^v/, "").split(".").map(Number);
const newer = (a: number[], b: number[]): boolean => {
  const index = a.findIndex((part, at) => part !== (b[at] ?? 0));
  return index !== -1 && (a[index] ?? 0) > (b[index] ?? 0);
};

async function manifest(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return parsed;
}

// The published SDK's engines floor is the pin's major; private packages run on the pin itself.
const root = await manifest("package.json");
const devEngines = isRecord(root) ? root["devEngines"] : undefined;
const nodeVersion = text(
  isRecord(devEngines) ? devEngines["runtime"] : undefined,
  "version",
);
const pinned = parseVersion(nodeVersion);
const sdk = await manifest("sdk/package.json");
const floor = text(isRecord(sdk) ? sdk["engines"] : undefined, "node");
if (floor !== `>=${String(pinned[0])}`) {
  problems.push(
    `sdk/package.json: engines.node is "${floor}", devEngines pins ${nodeVersion}`,
  );
}

const response = await fetch("https://nodejs.org/dist/index.json");
if (!response.ok) {
  throw new Error(`nodejs.org index: ${String(response.status)}`);
}
const releases: unknown = await response.json();
if (!Array.isArray(releases)) {
  throw new TypeError("nodejs.org index is not an array");
}
for (const release of releases) {
  if (!isRecord(release)) {
    continue;
  }
  const version = text(release, "version");
  const date = text(release, "date");
  if (
    parseVersion(version)[0] === pinned[0] &&
    newer(parseVersion(version), pinned) &&
    release["security"] === true &&
    Date.parse(date) <= cutoff
  ) {
    problems.push(`Node ${version} (security, ${date}) supersedes ${nodeVersion}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
