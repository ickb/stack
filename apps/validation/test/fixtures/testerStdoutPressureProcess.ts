import { pathToFileURL } from "node:url";
import { runTesterEntrypoint } from "../../src/tester.ts";

const entrypointPath = process.argv[1];
if (entrypointPath === undefined) {
  throw new Error("missing tester pressure fixture entrypoint path");
}

await runTesterEntrypoint(
  process.argv,
  pathToFileURL(entrypointPath).href,
  async (): Promise<void> => {
    await Promise.resolve();
    process.stdout.write(`${JSON.stringify({ pressure: "x".repeat(1024 * 1024) })}\n`);
    process.stdout.write(`${JSON.stringify({ final: true, status: 2 })}\n`);
    process.exitCode = 2;
  },
);
