// Mutates only the lines added since a base commit: `pnpm mutate:changed [base]`. The base
// defaults to where HEAD left origin/master.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Whether Stryker's `mutate` globs select the file, read in order as Stryker reads them: a
 * glob adds the files it matches, a `!` glob takes them away again.
 */
export function isMutated(file: string, globs: readonly string[]): boolean {
  let selected = false;
  for (const glob of globs) {
    if (glob.startsWith("!")) {
      selected &&= !path.matchesGlob(file, glob.slice(1));
    } else {
      selected ||= path.matchesGlob(file, glob);
    }
  }
  return selected;
}

/**
 * The added lines of a `git diff -U0` as Stryker `file:start-end` ranges, for the files the
 * globs select. A deletion adds no line, so it gives no range.
 */
export function changedRanges(diff: string, globs: readonly string[]): string[] {
  const ranges: string[] = [];
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      file = target.startsWith("b/") ? target.slice(2) : undefined;
      continue;
    }
    // The new side of a hunk header, "+start" or "+start,count".
    const added = /^@@ \S+ \+([\d,]+) @@/.exec(line)?.[1];
    if (added === undefined || file === undefined || !isMutated(file, globs)) {
      continue;
    }
    const [start = 0, count = 1] = added.split(",").map(Number);
    if (count > 0) {
      ranges.push(`${file}:${String(start)}-${String(start + count - 1)}`);
    }
  }
  return ranges;
}

function git(...args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- A developer tool: git comes from the same PATH as the pnpm that runs this script.
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
}

if (import.meta.main) {
  const base = process.argv[2] ?? git("merge-base", "origin/master", "HEAD").trim();
  const config: unknown = JSON.parse(readFileSync("stryker.config.json", "utf8"));
  const globs =
    typeof config === "object" && config !== null && "mutate" in config
      ? config.mutate
      : undefined;
  if (!Array.isArray(globs) || globs.some((glob) => typeof glob !== "string")) {
    throw new TypeError("stryker.config.json has no mutate list");
  }
  // Fixed options, so a user's diff settings cannot hide the paths or hunks parsed above.
  const diff = git(
    "diff",
    "-U0",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "--dst-prefix=b/",
    base,
  );
  // A --mutate list replaces the config's, so the config's globs, exclusions included,
  // pick the files here.
  const ranges = changedRanges(diff, globs);
  if (ranges.length === 0) {
    process.stdout.write(`No mutable lines added since ${base}.\n`);
  } else {
    // Through `pnpm mutate`, the one owner of the Stryker command; never incremental, which
    // can keep a survivor a new test kills.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- The pnpm that runs this script is on PATH.
    const run = spawnSync("pnpm", ["mutate", "--mutate", ranges.join(",")], {
      stdio: "inherit",
    });
    process.exitCode = run.status ?? 1;
  }
}
