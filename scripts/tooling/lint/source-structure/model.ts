import ts from "typescript";

export const packageJsonFile = "package.json";
export const testDirectoryName = "test";
export const sourceExtensions = new Set([".mts", ".ts", ".tsx"]);
export const javascriptExtensions = new Set([".js", ".jsx", ".mjs", ".cjs"]);
export const allowedMtsToolConfigNames = new Set([
  "eslint.config.mts",
  "prettier.config.mts",
  "vitest.config.mts",
]);
export const publishablePackageRoots = [
  "packages/core",
  "packages/dao",
  "packages/order",
  "packages/sdk",
  "packages/utils",
];
export const packageRoots = [
  ...publishablePackageRoots,
  "packages/bot",
  "packages/node-utils",
  "packages/testkit",
  "packages/validation",
];
export const buildSurfaceForbiddenModules = new Set(["@ickb/testkit", "vitest"]);
export const scriptIdentityFields = new Set(["args", "codeHash", "hashType"]);
export const scriptEqualityOperators = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

export const testHarnessWorkspaceRoots = new Set(["packages/testkit"]);
export const weakEslintDisableReasons = new Set([
  "because",
  "eslint",
  "fix later",
  "fixme",
  "lint",
  "needed",
  "required",
  "todo",
  "workaround",
]);

export type JsonValue =
  boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };

export interface PackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  exports?: JsonValue;
  main?: JsonValue;
  name?: string;
  packageManager?: unknown;
  peerDependencies?: Record<string, unknown>;
  private?: boolean;
  scripts?: Record<string, unknown>;
  types?: JsonValue;
}

export interface PackageMetadata {
  file: string;
  packageJson: PackageJson;
  root: string;
}

export type PackageScriptMetadata = PackageMetadata;

export type SourcesByFile = Map<string, string>;
export type PublicNamesByFile = Map<string, Set<string>>;

export interface Failure {
  action?: string;
  apiName?: string;
  command?: string;
  count?: number;
  directory?: string;
  expected?: string;
  file: string;
  field?: string;
  line?: number;
  message?: string;
  name?: string;
  packageFile?: string;
  packageName?: string;
  reference?: string;
  root?: string;
  rule: string;
  script?: string;
  specifier?: string;
  target?: string;
}
