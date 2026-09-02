import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import pathModule from "node:path";
import ts from "typescript";
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { minimalProcessEnv } from "../../../../packages/node-utils/src/index.ts";
import {
  allowedMtsToolConfigNames,
  javascriptExtensions,
  packageJsonFile,
  sourceExtensions,
  testDirectoryName,
  testHarnessWorkspaceRoots,
  type Failure,
} from "./model.ts";

const { extname, join, sep } = pathModule;

type ExportDeclaration = ts.ExportDeclaration;
type ImportDeclaration = ts.ImportDeclaration;
type ImportEqualsDeclaration = ts.ImportEqualsDeclaration;
export type ModifierLike = ts.ModifierLike;
export type Node = ts.Node;
export type NodeArray<T extends Node> = ts.NodeArray<T>;
export type PropertyName = ts.PropertyName;
export type SourceFile = ts.SourceFile;
export type Statement = ts.Statement;

export type ModuleStatement =
  ExportDeclaration | ImportDeclaration | ImportEqualsDeclaration;

export async function ownedRepositoryFiles(): Promise<string[]> {
  const result = spawnSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Git must follow the operator's allowlisted PATH instead of a host-specific absolute location.
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", env: minimalProcessEnv(process.env) },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${processOutput(result.stderr)}`);
  }
  return existingFiles(
    processOutput(result.stdout)
      .split("\0")
      .filter((file) => file !== "")
      .map(normalizePath),
  );
}

async function existingFiles(files: string[]): Promise<string[]> {
  const output: string[] = [];
  for (const file of files) {
    let fileStat: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      fileStat = await statPath(file);
    } catch (error) {
      if (isNotFoundError(error)) {
        continue;
      }
      throw error;
    }
    if (fileStat.isFile()) {
      output.push(file);
    }
  }
  return output;
}

function processOutput(output: string | Buffer): string {
  return typeof output === "string" ? output : output.toString("utf8");
}

export function workflowFiles(files: string[]): string[] {
  return files.filter((file) => {
    const normalized = normalizePath(file);
    const parts = normalized.split(sep);
    return (
      /\.ya?ml$/u.test(normalized) &&
      parts.some((part, index) => part === ".github" && parts[index + 1] === "workflows")
    );
  });
}

export function checkNoJavaScriptFiles(files: string[], output: Failure[]): void {
  for (const file of files) {
    if (javascriptExtensions.has(extname(file))) {
      output.push({ rule: "noJavaScriptSource", file });
    }
  }
}

export function checkMtsExtensionPolicy(files: string[], output: Failure[]): void {
  for (const file of files) {
    if (extname(file) !== ".mts" || isAllowedMtsToolConfig(file)) {
      continue;
    }
    output.push({ rule: "mtsExtensionPolicy", file });
  }
}

export function isAllowedMtsToolConfig(file: string): boolean {
  const parts = normalizePath(file).split(sep);
  const basename = parts.at(-1) ?? file;
  if (!allowedMtsToolConfigNames.has(basename)) {
    return false;
  }
  return parts.length === 1 || /^[^/]+\/[^/]+$/u.test(parts.slice(0, -1).join("/"));
}

export async function checkKnipJavaScriptReferences(output: Failure[]): Promise<void> {
  const file = "knip.jsonc";
  const source = await readOptionalText(file);
  if (source === undefined) {
    return;
  }
  for (const [index, line] of source.split("\n").entries()) {
    if (
      /\.(?:cjs|js|jsx|mjs)\b/u.test(line) ||
      (line.includes("{") && /\b(?:cjs|js|jsx|mjs)\b/u.test(line))
    ) {
      output.push({ rule: "knipJavaScriptReference", file, line: index + 1 });
    }
  }
}

export function checkWorkflowLocations(files: string[], output: Failure[]): void {
  for (const file of files) {
    if (!isRootWorkflowFile(file)) {
      output.push({ rule: "nestedWorkflowLocation", file });
    }
  }
}

export async function checkWorkflowPolicy(
  files: string[],
  output: Failure[],
): Promise<void> {
  for (const file of files) {
    if (!isRootWorkflowFile(file) || !/\.ya?ml$/u.test(file)) {
      continue;
    }
    const source = await readText(file);
    checkWorkflowSource(file, source, output);
  }
}

export function checkWorkflowSource(
  file: string,
  source: string,
  output: Failure[],
): void {
  const parsed = parsedWorkflow(file, source, output);
  if (parsed === undefined) {
    return;
  }
  for (const { action, line } of parsed.uses) {
    if (isUnpinnedRemoteAction(action)) {
      output.push({
        rule: "unpinnedWorkflowAction",
        file,
        line,
        action,
      });
    }
  }

  if (normalizePath(file) !== `.github${sep}workflows${sep}check.yaml`) {
    return;
  }
  if (!hasReadOnlyEffectivePermissions(parsed.value)) {
    output.push({ rule: "checkWorkflowPermissions", file });
  }
  const checkoutUses = parsed.uses.filter(({ action }) =>
    action.startsWith("actions/checkout@"),
  );
  for (const [index, step] of checkoutSteps(parsed.value).entries()) {
    if (!checkoutDisablesCredentialPersistence(step)) {
      output.push({
        rule: "checkoutCredentialPersistence",
        file,
        line: checkoutUses[index]?.line ?? 1,
      });
    }
  }
}

function isRootWorkflowFile(file: string): boolean {
  const parts = normalizePath(file).split(sep);
  return parts.length === 3 && parts[0] === ".github" && parts[1] === "workflows";
}

interface ParsedWorkflow {
  uses: WorkflowUse[];
  value: unknown;
}

interface WorkflowUse {
  action: string;
  line: number;
}

function parsedWorkflow(
  file: string,
  source: string,
  output: Failure[],
): ParsedWorkflow | undefined {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  if (document.errors.length > 0) {
    output.push({
      rule: "invalidWorkflowYaml",
      file,
      message: document.errors.map(({ message }) => message).join("; "),
    });
    return undefined;
  }
  const uses = workflowUses(document.get("jobs", true), lineCounter);
  const value: unknown = document.toJS();
  return { uses, value };
}

function workflowUses(jobsValue: unknown, lineCounter: LineCounter): WorkflowUse[] {
  if (!isMap(jobsValue)) {
    return [];
  }
  return jobsValue.items.flatMap(({ value: jobValue }) => {
    if (!isMap(jobValue)) {
      return [];
    }
    const uses = actionUse(jobValue.get("uses", true), lineCounter);
    const stepsValue = jobValue.get("steps", true);
    if (!isSeq(stepsValue)) {
      return uses;
    }
    return [
      ...uses,
      ...stepsValue.items.flatMap((stepValue) =>
        isMap(stepValue) ? actionUse(stepValue.get("uses", true), lineCounter) : [],
      ),
    ];
  });
}

function actionUse(value: unknown, lineCounter: LineCounter): WorkflowUse[] {
  if (!isScalar(value) || typeof value.value !== "string") {
    return [];
  }
  const start = value.range?.[0] ?? 0;
  return [{ action: value.value, line: lineCounter.linePos(start).line }];
}

function hasReadOnlyEffectivePermissions(value: unknown): boolean {
  const workflow = recordFrom(value);
  const jobs = recordFrom(workflow?.["jobs"]);
  if (workflow === undefined || jobs === undefined || Object.keys(jobs).length === 0) {
    return false;
  }
  return Object.values(jobs).every((jobValue) => {
    const job = recordFrom(jobValue);
    return hasReadOnlyContentsPermission(job?.["permissions"] ?? workflow["permissions"]);
  });
}

function hasReadOnlyContentsPermission(value: unknown): boolean {
  const permissions = recordFrom(value);
  return (
    permissions?.["contents"] === "read" &&
    Object.values(permissions).every((permission) => permission !== "write")
  );
}

function checkoutSteps(value: unknown): Array<Record<string, unknown>> {
  const jobs = recordFrom(recordFrom(value)?.["jobs"]);
  if (jobs === undefined) {
    return [];
  }
  return Object.values(jobs).flatMap((jobValue) => {
    const steps = recordFrom(jobValue)?.["steps"];
    if (!Array.isArray(steps)) {
      return [];
    }
    return steps.flatMap((stepValue) => {
      const step = recordFrom(stepValue);
      return typeof step?.["uses"] === "string" &&
        step["uses"].startsWith("actions/checkout@")
        ? [step]
        : [];
    });
  });
}

function checkoutDisablesCredentialPersistence(step: Record<string, unknown>): boolean {
  const persistCredentials = recordFrom(step["with"])?.["persist-credentials"];
  return persistCredentials === false || persistCredentials === "false";
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnpinnedRemoteAction(action: string): boolean {
  if (action.startsWith("./") || action.startsWith("../")) {
    return false;
  }
  if (action.startsWith("docker://")) {
    return !/^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/iu.test(action);
  }
  if (!action.includes("@")) {
    return true;
  }
  const reference = action.slice(action.lastIndexOf("@") + 1);
  return !/^[0-9a-f]{40}$/iu.test(reference);
}

export async function readOptionalText(file: string): Promise<string | undefined> {
  try {
    return await readText(file);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function readText(file: string): Promise<string> {
  return readFile(file, "utf8");
}

async function statPath(file: string): Promise<Awaited<ReturnType<typeof stat>>> {
  return stat(file);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function isSourceFile(path: string): boolean {
  return [...sourceExtensions].some((extension) => path.endsWith(extension));
}

function isUnderSrc(path: string): boolean {
  return path.split(sep).includes("src");
}

export function isUnderTestDirectory(path: string): boolean {
  const parts = new Set(path.split(sep));
  return parts.has(testDirectoryName) || parts.has("tests");
}

export function isUnderNonCanonicalTestsDirectory(path: string): boolean {
  return path.split(sep).includes("tests");
}

export function isProductionSource(file: string): boolean {
  const normalized = normalizePath(file);
  const workspaceRoot = workspaceRootOfFile(normalized);
  return (
    (workspaceRoot === undefined || !testHarnessWorkspaceRoots.has(workspaceRoot)) &&
    (normalized.startsWith(`apps${sep}`) || normalized.startsWith(`packages${sep}`)) &&
    isUnderSrc(normalized) &&
    !isTestOnlySource(normalized)
  );
}

export function isTestOnlySource(file: string): boolean {
  const name = file.split(sep).at(-1) ?? file;
  if (isUnderTestDirectory(file)) {
    return true;
  }
  return isTestRelatedSourceName(name);
}

export function isTestRelatedSourceName(file: string): boolean {
  const name = file.split(sep).at(-1) ?? file;
  return (
    /\.test\.(?:mts|ts|tsx)$/u.test(name) ||
    /Suite\d*\.test\./u.test(name) ||
    isPascalTestRelatedSourceName(name) ||
    isSnakeTestRelatedSourceName(name)
  );
}

function isPascalTestRelatedSourceName(name: string): boolean {
  return (
    /Test(?:Assertions|CommandFixtures|Constants|Fixtures|ProcessFixtures|RunFixtures|Support)\./u.test(
      name,
    ) || name.includes("Suite.")
  );
}

function isSnakeTestRelatedSourceName(name: string): boolean {
  return name.includes("_test_");
}

export function isTestSuiteSource(file: string): boolean {
  return isUnderTestDirectory(file) || /\.test\.(?:mts|ts|tsx)$/u.test(file);
}

export function isTestSupportSource(file: string): boolean {
  return normalizePath(file)
    .split(sep)
    .some((part) => /^(?:support|fixtures?)$/u.test(part));
}

export function workspaceRootOfFile(file: string): string | undefined {
  const parts = normalizePath(file).split(sep);
  const [parent, name] = parts;
  if ((parent !== "apps" && parent !== "packages") || name === undefined) {
    return undefined;
  }
  if (!parts.includes("src") && !isUnderTestDirectory(file)) {
    return undefined;
  }
  return `${parent}${sep}${name}`;
}

export function directoryOf(file: string): string {
  const parts = normalizePath(file).split(sep);
  return parts.length === 1 ? "." : parts.slice(0, -1).join(sep);
}

export function normalizePath(file: string): string {
  return file.split(/[\\/]/u).join(sep);
}

export function resolveLocalSourceModule(
  file: string,
  specifier: string,
  sourceFileSet: Set<string>,
): string | undefined {
  const base = normalizePath(join(file, "..", specifier));
  const candidates = isSourceFile(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.mts"),
      ];
  return candidates.map(normalizePath).find((candidate) => sourceFileSet.has(candidate));
}

export function resolveLocalModule(file: string, specifier: string): string {
  const base = join(file, "..");
  const resolved = normalizePath(join(base, specifier));
  return isSourceFile(resolved) ? resolved : `${resolved}.ts`;
}

export function packageRootFromFile(file: string): string {
  return file === packageJsonFile ? "." : file.split(sep).slice(0, 2).join(sep);
}

export function parseSource(file: string, source: string): SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

export function lineOf(sourceFile: SourceFile, node: Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function visit(node: Node, callback: (node: Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => {
    visit(child, callback);
  });
}

export function isSideEffectImport(statement: Statement): boolean {
  return (
    ts.isImportDeclaration(statement) &&
    statement.importClause === undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
  );
}

export function isModuleImportOrExport(
  statement: Statement,
): statement is ModuleStatement {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement)
  );
}

export function moduleSpecifierText(statement: Statement): string | undefined {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    return statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  }
  if (
    ts.isImportEqualsDeclaration(statement) &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    ts.isStringLiteral(statement.moduleReference.expression)
  ) {
    return statement.moduleReference.expression.text;
  }
  return undefined;
}

export function hasExportModifier(
  node: Node & { modifiers?: NodeArray<ModifierLike> },
): boolean {
  return (
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

export function propertyNameText(name: PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return "<computed>";
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}
