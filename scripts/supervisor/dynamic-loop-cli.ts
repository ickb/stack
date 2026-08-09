#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runDynamicSupervisorLoop } from "./dynamic-loop/runtime.ts";

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exitCode = await runDynamicSupervisorLoop({ argv: process.argv.slice(2) });
}
