import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTool } from "../run_tool.ts";

interface ManifestEntry {
  name: string;
  owner: string | null;
  kind: "value" | "type";
  expectedMissing?: boolean;
  note?: string;
}

interface FixtureVerdict {
  missing: Set<string>;
  notAValue: Set<string>;
}

const checkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(checkDirectory, "../../../..");
const scratchDirectory = path.join(checkDirectory, "scratch");
const tsconfigFile = "tsconfig.json";

const entries = await readManifest();
await writeConsumerFixture(entries);
let verdict;
try {
  verdict = compileConsumerFixture();
} finally {
  // Never leave scratch behind: its .ts files would leak into the root
  // tsconfig, eslint, and knip globs and redden unrelated lint lanes.
  await rm(scratchDirectory, { recursive: true, force: true });
}
if (report(entries, verdict)) {
  process.exitCode = 1;
}

async function readManifest(): Promise<ManifestEntry[]> {
  const raw: unknown = JSON.parse(
    await readFile(path.join(checkDirectory, "manifest.json"), "utf8"),
  );
  if (!Array.isArray(raw)) {
    throw new TypeError("root-export-floor: manifest.json must be an array");
  }
  const list: unknown[] = raw;
  return list.map((entry) => {
    if (!isManifestEntry(entry)) {
      throw new Error(
        `root-export-floor: invalid manifest entry ${JSON.stringify(entry)}`,
      );
    }
    return entry;
  });
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    /^[A-Za-z_$][\w$]*$/u.test(value.name) &&
    "owner" in value &&
    (value.owner === null ||
      (typeof value.owner === "string" && /^[a-z-]+$/u.test(value.owner))) &&
    "kind" in value &&
    (value.kind === "value" || value.kind === "type")
  );
}

async function writeConsumerFixture(manifest: ManifestEntry[]): Promise<void> {
  const byOwner = new Map<string, ManifestEntry[]>();
  for (const entry of manifest) {
    if (entry.owner !== null) {
      const owned = byOwner.get(entry.owner) ?? [];
      owned.push(entry);
      byOwner.set(entry.owner, owned);
    }
  }

  await rm(scratchDirectory, { recursive: true, force: true });
  await mkdir(scratchDirectory, { recursive: true });
  for (const [owner, owned] of byOwner) {
    const barrel = path.relative(
      scratchDirectory,
      path.join(repositoryRoot, "packages", owner, "src", "index.ts"),
    );
    const names = owned.map((entry) => entry.name).join(", ");
    const valueChecks = owned
      .filter((entry) => entry.kind === "value")
      .map((entry) => `export type ValueOf_${entry.name} = typeof barrel.${entry.name};`);
    await writeScratchFile(
      `${owner}.ts`,
      [
        `import type * as barrel from "${barrel}";`,
        `export type { ${names} } from "${barrel}";`,
        ...valueChecks,
        "",
      ].join("\n"),
    );
  }
  const rootTsconfig = path.relative(
    scratchDirectory,
    path.join(repositoryRoot, tsconfigFile),
  );
  await writeScratchFile(
    tsconfigFile,
    `${JSON.stringify(
      {
        extends: rootTsconfig,
        compilerOptions: { types: ["node"] },
        include: ["*.ts"],
      },
      undefined,
      2,
    )}\n`,
  );
}

async function writeScratchFile(fileName: string, content: string): Promise<void> {
  await writeFile(path.join(scratchDirectory, fileName), content);
}

/**
 * Typechecks the generated consumer fixture. Missing names surface as
 * TS2305/TS2724 on the type-only re-export; type-only impostors of value
 * names surface as TS2339/TS2694 on the `typeof barrel.<name>` check.
 */
function compileConsumerFixture(): FixtureVerdict {
  const result = runTool({
    repositoryRoot,
    tool: "tsgo",
    toolArguments: ["-p", tsconfigFile],
    cwd: scratchDirectory,
  });
  const { output } = result;
  const missing = new Set<string>();
  for (const match of output.matchAll(
    /error TS(?:2305|2724):[^\n]*?exported member (?:named )?'([^']+)'/gu,
  )) {
    const name = match[1];
    if (name !== undefined) {
      missing.add(name);
    }
  }
  const notAValue = new Set<string>();
  for (const match of output.matchAll(/Property '([^']+)' does not exist/gu)) {
    const name = match[1];
    if (name !== undefined && !missing.has(name)) {
      notAValue.add(name);
    }
  }
  const unexpected = [...output.matchAll(/error TS(\d+)/gu)]
    .map((match) => match[1])
    .filter((code) => !["2305", "2339", "2551", "2694", "2724"].includes(code ?? ""));
  const detected = missing.size > 0 || notAValue.size > 0;
  if (unexpected.length > 0 || (result.status !== 0 && !detected)) {
    console.error(output);
    throw new Error(
      `root-export-floor: unexpected typecheck failure (status ${String(result.status)})`,
    );
  }
  return { missing, notAValue };
}

function report(manifest: ManifestEntry[], result: FixtureVerdict): boolean {
  let failures = 0;
  let known = 0;
  for (const entry of manifest) {
    const failed = reportEntry(entry, result);
    failures += failed === "fail" ? 1 : 0;
    known += failed === "known" ? 1 : 0;
  }
  const summary = `root-export-floor: ${String(failures)} failing, ${String(known)} known-missing of ${String(manifest.length)} floor names`;
  console.error(failures > 0 ? `FAIL — ${summary}` : `PASS — ${summary}`);
  return failures > 0;
}

function reportEntry(
  entry: ManifestEntry,
  result: FixtureVerdict,
): "fail" | "known" | "ok" {
  if (entry.owner === null) {
    console.error(`PENDING        ${entry.name} — ${entry.note ?? "no current owner"}`);
    return "ok";
  }
  const detail = entry.note === undefined ? "" : ` (${entry.note})`;
  if (result.missing.has(entry.name)) {
    if (entry.expectedMissing === true) {
      console.error(`KNOWN-MISSING  ${entry.name} — @ickb/${entry.owner}${detail}`);
      return "known";
    }
    console.error(
      `MISSING        ${entry.name} — not exported by the @ickb/${entry.owner} barrel${detail}`,
    );
    return "fail";
  }
  if (entry.kind === "value" && result.notAValue.has(entry.name)) {
    console.error(
      `NOT-A-VALUE    ${entry.name} — exported by @ickb/${entry.owner} as a type only${detail}`,
    );
    return "fail";
  }
  if (entry.expectedMissing === true) {
    console.error(
      `RESOLVED       ${entry.name} — now exported by @ickb/${entry.owner}; remove expectedMissing from manifest.json`,
    );
    return "fail";
  }
  console.error(`OK             ${entry.name} (@ickb/${entry.owner})`);
  return "ok";
}
