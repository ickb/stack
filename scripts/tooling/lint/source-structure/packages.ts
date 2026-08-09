import pathModule from "node:path";
import type ts from "typescript";
import {
  packageJsonFile,
  packageRoots,
  publishablePackageRoots,
  type Failure,
  type JsonValue,
  type PackageJson,
  type PackageMetadata,
  type PackageScriptMetadata,
  type SourcesByFile,
} from "./model.ts";
import {
  compareStrings,
  isAllowedMtsToolConfig,
  isTestOnlySource,
  moduleSpecifierText,
  normalizePath,
  packageRootFromFile,
  parseSource,
  readOptionalText,
  workspaceRootOfFile,
} from "./repository.ts";

const { sep } = pathModule;
const requiredPublishablePackageScripts = ["build", "lint:api", "lint:publish"];

export function checkPackageScriptReferences(
  packages: PackageScriptMetadata[],
  output: Failure[],
): void {
  for (const { file, packageJson } of packages) {
    for (const [script, command] of Object.entries(packageJson.scripts ?? {})) {
      if (typeof command !== "string") {
        continue;
      }
      checkPackageScriptCommand(file, script, command, output);
    }
  }
}

function checkPackageScriptCommand(
  file: string,
  script: string,
  command: string,
  output: Failure[],
): void {
  for (const reference of javaScriptReferencesInCommand(command)) {
    output.push({
      rule: "packageScriptJavaScriptReference",
      file,
      script,
      reference,
      command,
    });
  }

  for (const reference of mtsReferencesInCommand(command)) {
    if (isAllowedMtsToolConfig(reference)) {
      continue;
    }
    output.push({
      rule: "packageScriptMtsReference",
      file,
      script,
      reference,
      command,
    });
  }
}

function mtsReferencesInCommand(command: string): Set<string> {
  const references = new Set<string>();
  for (const token of command.split(/[\s"',;:)}\]&|<>]+/u)) {
    if (token.endsWith(".mts")) {
      references.add(token);
    }
  }
  for (const extension of braceListItems(command)) {
    if (extension === "mts") {
      references.add(".mts");
    }
  }
  return references;
}

function javaScriptReferencesInCommand(command: string): Set<string> {
  const references = new Set<string>();
  for (const token of command.split(/[\s"',;:)}\]&|<>]+/u)) {
    if (/\.(?:cjs|js|jsx|mjs)$/u.test(token)) {
      references.add(token);
    }
  }
  for (const extension of braceListItems(command)) {
    if (/^(?:cjs|js|jsx|mjs)$/u.test(extension)) {
      references.add(`.${extension}`);
    }
  }
  return references;
}

function braceListItems(command: string): string[] {
  const items: string[] = [];
  let start = command.indexOf("{");
  while (start !== -1) {
    const end = command.indexOf("}", start + 1);
    if (end === -1) {
      return items;
    }
    items.push(...command.slice(start + 1, end).split(","));
    start = command.indexOf("{", end + 1);
  }
  return items;
}

export async function collectPackageMetadata(
  files: string[],
): Promise<PackageMetadata[]> {
  const packages: PackageMetadata[] = [];
  for (const file of files) {
    if (!/^packages\/[^/]+\/package\.json$/u.test(file)) {
      continue;
    }
    const text = await readOptionalText(file);
    if (text === undefined) {
      continue;
    }
    const root = file.split(sep).slice(0, 2).join(sep);
    packages.push({ file, root, packageJson: parsePackageJson(text) });
  }
  return packages;
}

export async function collectPackageScripts(
  files: string[],
): Promise<PackageScriptMetadata[]> {
  const packages: PackageScriptMetadata[] = [];
  for (const file of packageJsonFiles(files)) {
    const text = await readOptionalText(file);
    if (text !== undefined) {
      const root = packageRootFromFile(file);
      packages.push({
        file,
        root,
        packageJson: parsePackageJson(text),
      });
    }
  }
  return packages;
}

function parsePackageJson(text: string): PackageJson {
  const value: unknown = JSON.parse(text);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function packageJsonFiles(files: string[]): string[] {
  return files
    .filter(
      (file) => file === packageJsonFile || /^[^/]+\/[^/]+\/package\.json$/u.test(file),
    )
    .toSorted(compareStrings);
}

export function checkRootPackageManagerIntegrity(
  packages: PackageScriptMetadata[],
  output: Failure[],
): void {
  const rootPackage = packages.find((metadata) => metadata.root === ".");
  const packageManager = rootPackage?.packageJson.packageManager;
  if (
    typeof packageManager === "string" &&
    /^pnpm@\d+\.\d+\.\d+\+sha512\.[A-Za-z0-9+/=]+$/u.test(packageManager)
  ) {
    return;
  }
  output.push({ rule: "rootPackageManagerIntegrity", file: packageJsonFile });
}

export function checkWorkspaceDependencyDeclarations(
  packages: PackageScriptMetadata[],
  sources: SourcesByFile,
  output: Failure[],
): void {
  const packagesByRoot = new Map(packages.map((metadata) => [metadata.root, metadata]));
  for (const [file, source] of sources) {
    const workspaceRoot = workspaceRootOfFile(file);
    if (workspaceRoot === undefined) {
      continue;
    }
    const metadata = packagesByRoot.get(workspaceRoot);
    if (metadata === undefined) {
      continue;
    }

    const sourceFile = parseSource(file, source);
    for (const specifier of moduleSpecifiers(sourceFile)) {
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName === undefined || packageName === metadata.packageJson.name) {
        continue;
      }

      const dependencyKind = dependencyKindForFile(
        file,
        metadata.packageJson,
        packageName,
      );
      if (dependencyKind !== undefined) {
        output.push({
          rule: dependencyKind,
          file,
          packageFile: metadata.file,
          packageName,
        });
      }
    }
  }
}

function dependencyKindForFile(
  file: string,
  packageJson: PackageJson,
  packageName: string,
): string | undefined {
  const hasDependency = hasPackageDependency(packageJson.dependencies, packageName);
  const hasDevDependency = hasPackageDependency(packageJson.devDependencies, packageName);
  const hasPeerDependency = hasPackageDependency(
    packageJson.peerDependencies,
    packageName,
  );
  if (isTestOnlySource(file)) {
    return hasDependency || hasDevDependency || hasPeerDependency
      ? undefined
      : "workspaceTestImportDependency";
  }
  return hasDependency || hasPeerDependency
    ? undefined
    : "workspaceSourceImportDependency";
}

function hasPackageDependency(
  dependencies: Record<string, unknown> | undefined,
  packageName: string,
): boolean {
  return (
    dependencies !== undefined &&
    typeof dependencies === "object" &&
    Object.hasOwn(dependencies, packageName)
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => {
    const specifier = moduleSpecifierText(statement);
    return specifier === undefined ? [] : [specifier];
  });
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith("@ickb/") || specifier.startsWith("@ckb-ccc/")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return undefined;
}

export function checkPackageRootCoverage(
  packages: PackageMetadata[],
  output: Failure[],
): void {
  const packageRootSet = new Set(packageRoots.map(normalizePath));
  const publishablePackageRootSet = new Set(publishablePackageRoots.map(normalizePath));
  for (const metadata of packages) {
    const { packageJson, root } = metadata;
    if (exportsSource(packageJson) && !packageRootSet.has(root)) {
      output.push({ rule: "packageRootCoverage", file: metadata.file, root });
    }
    if (packageJson.private !== true && !publishablePackageRootSet.has(root)) {
      output.push({ rule: "publishablePackageRootCoverage", file: metadata.file, root });
    }
    if (!publishablePackageRootSet.has(root)) {
      continue;
    }
    for (const script of requiredPublishablePackageScripts) {
      if (typeof packageJson.scripts?.[script] !== "string") {
        output.push({
          rule: "publishablePackageScript",
          file: metadata.file,
          root,
          script,
        });
      }
    }
  }
}

function exportsSource(packageJson: PackageJson): boolean {
  return sourceBackedPackageField(packageJson.main) ||
    sourceBackedPackageField(packageJson.types) ||
    sourceBackedPackageField(packageJson.exports)
    ? true
    : false;
}

function sourceBackedPackageField(value: JsonValue | undefined): boolean {
  if (typeof value === "string") {
    return /(?:^|\/)src\//u.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(sourceBackedPackageField);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(sourceBackedPackageField);
  }
  return false;
}
