import pathModule from "node:path";
import ts from "typescript";
import { buildSurfaceForbiddenModules, type Failure } from "./model.ts";
import {
  diagnosticMessage,
  isModuleImportOrExport,
  isSourceFile,
  isTestOnlySource,
  moduleSpecifierText,
  normalizePath,
  parseSource,
  resolveLocalModule,
} from "./repository.ts";

const { resolve, sep } = pathModule;

export function checkBuildSurface(packageRoot: string, output: Failure[]): void {
  const configPath = resolve(packageRoot, "tsconfig.build.json");
  const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  if (config.error !== undefined) {
    output.push({
      rule: "buildSurfaceConfig",
      file: configPath,
      message: diagnosticMessage(config.error),
    });
    return;
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    packageRoot,
    undefined,
    configPath,
  );
  for (const diagnostic of parsed.errors) {
    output.push({
      rule: "buildSurfaceConfig",
      file: configPath,
      message: diagnosticMessage(diagnostic),
    });
  }

  const sourceRoot = `${normalizePath(resolve(packageRoot, "src"))}${sep}`;
  const buildFiles = parsed.fileNames
    .map((file) => normalizePath(file))
    .filter((file) => file.startsWith(sourceRoot) && isSourceFile(file));

  for (const file of buildFiles) {
    if (isTestOnlySource(file)) {
      output.push({ rule: "buildSurfaceTestFile", file });
      continue;
    }
    const source = ts.sys.readFile(file);
    if (source !== undefined) {
      checkBuildSurfaceImports(file, source, output);
    }
  }
}

function checkBuildSurfaceImports(file: string, source: string, output: Failure[]): void {
  const sourceFile = parseSource(file, source);
  for (const statement of sourceFile.statements) {
    if (!isModuleImportOrExport(statement)) {
      continue;
    }
    const specifier = moduleSpecifierText(statement);
    if (specifier === undefined) {
      continue;
    }
    if (buildSurfaceForbiddenModules.has(specifier)) {
      output.push({ rule: "buildSurfaceTestImport", file, specifier });
      continue;
    }
    if (
      specifier.startsWith(".") &&
      isTestOnlySource(resolveLocalModule(file, specifier))
    ) {
      output.push({ rule: "buildSurfaceTestImport", file, specifier });
    }
  }
}
