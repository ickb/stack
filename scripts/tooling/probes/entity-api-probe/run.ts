import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTool, type ToolResult } from "../run_tool.ts";

const probeDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(probeDirectory, "../../../..");
const scratchDirectory = path.join(probeDirectory, "scratch");
const rootFromScratch = path.relative(scratchDirectory, repositoryRoot);
const templateFiles = ["index.ts", "entity_base.ts"];
const recipeExport = "export const ProbeDataBase";
const apiExtractorTool = "api-extractor";

try {
  await assembleScratch({ breakRecipe: false });
  buildAndExtract((tool, result) => {
    if (result.status === 0) {
      return;
    }
    console.error(result.output);
    throw new Error(
      `entity-api-probe: ${tool} exited with status ${String(result.status)}`,
    );
  });

  // Negative control: the same recipe with the base export removed must fail
  // with ae-forgotten-export, or the gate has silently demoted (for example a
  // future api-extractor.base.json edit downgrading the message severity).
  await assembleScratch({ breakRecipe: true });
  verifyNegativeControl();
} finally {
  // Never leave scratch behind: its .ts files would leak into the root
  // tsconfig, eslint, and knip globs and redden unrelated lint lanes.
  await rm(scratchDirectory, { recursive: true, force: true });
}
console.error(
  "entity-api-probe: PASS — the B4 entity pattern builds with the repo emit toolchain and passes api-extractor; the negative control still fails on ae-forgotten-export.",
);

async function assembleScratch(options: { breakRecipe: boolean }): Promise<void> {
  await rm(scratchDirectory, { recursive: true, force: true });
  await mkdir(path.join(scratchDirectory, "src"), { recursive: true });
  for (const templateFile of templateFiles) {
    const content = await readFile(
      path.join(probeDirectory, "template", `${templateFile}.txt`),
      "utf8",
    );
    await writeScratchFile(
      path.join("src", templateFile),
      options.breakRecipe
        ? content.replace(recipeExport, "const ProbeDataBase")
        : content,
    );
  }
  const scopeDirectory = path.join(scratchDirectory, "node_modules", "@ckb-ccc");
  await mkdir(scopeDirectory, { recursive: true });
  await symlink(
    await realpath(path.join(repositoryRoot, "packages/core/node_modules/@ckb-ccc/core")),
    path.join(scopeDirectory, "core"),
    "dir",
  );
  await writeScratchJson("package.json", {
    name: "entity-api-probe",
    version: "0.0.0",
    private: true,
    type: "module",
  });
  await writeScratchJson("tsconfig.build.json", {
    extends: path.join(rootFromScratch, "tsconfig.json"),
    compilerOptions: {
      noEmit: false,
      removeComments: false,
      rewriteRelativeImportExtensions: true,
      rootDir: "src",
      outDir: "dist",
      sourceRoot: "../src",
    },
    include: ["src"],
  });
  await writeScratchJson("api-extractor.json", {
    extends: path.join(rootFromScratch, "api-extractor.base.json"),
    projectFolder: ".",
    mainEntryPointFilePath: "<projectFolder>/dist/index.d.ts",
  });
}

/** Mirrors the package build (`tsgo` + d.ts import rewrite) and runs api-extractor. */
function buildAndExtract(onResult: (tool: string, result: ToolResult) => void): void {
  const rewriteScript = path.join(
    repositoryRoot,
    "scripts/tooling/build/rewrite-dts-imports.ts",
  );
  onResult("tsgo", probeTool("tsgo", ["-p", "tsconfig.build.json"]));
  onResult("node", probeTool("node", [rewriteScript, "dist"], process.execPath));
  onResult(apiExtractorTool, probeTool(apiExtractorTool, ["run"]));
}

function verifyNegativeControl(): void {
  let failure: { tool: string; result: ToolResult } | undefined;
  buildAndExtract((tool, result) => {
    failure ??= result.status === 0 ? undefined : { tool, result };
  });
  if (failure === undefined) {
    throw new Error(
      "entity-api-probe: negative control FAILED — removing the base export no longer breaks the pipeline; the ae-forgotten-export gate has silently demoted",
    );
  }
  if (
    failure.tool !== apiExtractorTool ||
    !failure.result.output.includes("ae-forgotten-export")
  ) {
    console.error(failure.result.output);
    throw new Error(
      `entity-api-probe: negative control FAILED — expected api-extractor to report ae-forgotten-export, but ${failure.tool} failed differently`,
    );
  }
}

function probeTool(tool: string, toolArguments: string[], command?: string): ToolResult {
  return runTool({
    repositoryRoot,
    tool,
    toolArguments,
    cwd: scratchDirectory,
    command,
  });
}

async function writeScratchFile(fileName: string, content: string): Promise<void> {
  await writeFile(path.join(scratchDirectory, fileName), content);
}

async function writeScratchJson(fileName: string, data: object): Promise<void> {
  await writeScratchFile(fileName, `${JSON.stringify(data, undefined, 2)}\n`);
}
