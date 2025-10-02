import type { TypeDocOptions } from "typedoc";

/** @type {Partial<TypeDocOptions>} */
const config: Partial<TypeDocOptions> = {
  $schema: "https://typedoc.org/schema.json",
  name: "iCKB/Stack Docs",
  entryPoints: ["packages/utils", "packages/core"],
  entryPointStrategy: "packages",
  readme: "README.md",
  // theme/plugin-specific options removed or moved to plugin config
};

export default config;

