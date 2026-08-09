#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runBotLauncher } from "./launcher/index.ts";

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const result = await runBotLauncher();
  if (result.signal !== undefined) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.status);
  }
}
