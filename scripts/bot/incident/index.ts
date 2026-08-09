import { fileURLToPath } from "node:url";

import { parseArgs, parseTimeBound, usage } from "./args.ts";
import { collectIncidentBundle } from "./bundle.ts";
import { resolveIncidentPaths } from "./model/paths.ts";
import { publicErrorMessage } from "./model/text.ts";
import type {
  CollectIncidentOptions,
  CollectIncidentResult,
  WritableLike,
} from "./model/types.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));

export async function collectIncident({
  argv = process.argv.slice(2),
  envLogRoot = process.env["ICKB_BOT_LOG_ROOT"],
  now = (): Date => new Date(),
  root = rootDir,
  dependencies = {},
}: CollectIncidentOptions = {}): Promise<CollectIncidentResult> {
  const parsed = parseArgs(argv);
  if (parsed.help === true) {
    return { help: usage() };
  }

  const createdAt = now();
  const since = parseTimeBound(parsed.since, createdAt);
  const until = parseTimeBound(parsed.until, createdAt);
  if (since.getTime() > until.getTime()) {
    throw new Error("--since must be before or equal to --until");
  }

  const paths = resolveIncidentPaths({ parsed, envLogRoot, root });
  return collectIncidentBundle({
    createdAt,
    dependencies,
    paths,
    root,
    window: { since, until },
  });
}

export async function main(
  argv: string[],
  io: { stderr?: WritableLike; stdout?: WritableLike } = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const result = await collectIncident({ argv });
    if (result.help !== undefined) {
      stdout.write(`${result.help}\n`);
      return 0;
    }
    stdout.write(`Incident bundle directory: ${result.incidentDir}\n`);
    stdout.write(`Compression command: ${result.summary.compression.command}\n`);
    return 0;
  } catch (error) {
    stderr.write(
      `Incident collection failed: ${publicErrorMessage(error)}\n${usage()}\n`,
    );
    return 1;
  }
}
