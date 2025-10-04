/** @type {Partial<import("typedoc").TypeDocOptions>} */
const config = {
  $schema: "https://typedoc.org/schema.json",
  name: "iCKB Stack Docs",
  entryPoints: ["packages/*"],
  entryPointStrategy: "packages",
  readme: "README.md",
  // theme/plugin-specific options removed or moved to plugin config
};

export default config;
