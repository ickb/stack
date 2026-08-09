#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { main } from "./incident/index.ts";

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  process.exit(await main(process.argv.slice(2)));
}
