import type { Failure } from "./model.ts";

type FailureFormatter = (failure: Failure) => string;

const packageFailureFormatters = new Map<string, FailureFormatter>([
  [
    "packageScriptJavaScriptReference",
    (failure): string =>
      `${failure.file}: script ${requiredString(failure.script)} references JavaScript ${requiredString(failure.reference)} in ${JSON.stringify(requiredString(failure.command))}. Convert the target to TypeScript and update the command to the .ts entrypoint.`,
  ],
  [
    "packageScriptMtsReference",
    (failure): string =>
      `${failure.file}: script ${requiredString(failure.script)} references ${requiredString(failure.reference)} in ${JSON.stringify(requiredString(failure.command))}. Use .ts for scripts; reserve .mts for tool config files that require that extension.`,
  ],
  [
    "packageRootCoverage",
    (failure): string =>
      `${failure.file}: source-backed package ${requiredString(failure.root)} is missing from packageRoots in the source structure linter. Add it so public API and build-surface checks do not silently skip this package.`,
  ],
  [
    "publishablePackageRootCoverage",
    (failure): string =>
      `${failure.file}: non-private package ${requiredString(failure.root)} is missing from publishablePackageRoots in the source structure linter. Add it so build-surface and public API checks cover published packages.`,
  ],
  [
    "publishablePackageScript",
    (failure): string =>
      `${failure.file}: publishable package ${requiredString(failure.root)} must own a ${requiredString(failure.script)} script so recursive release gates cannot silently skip it.`,
  ],
]);

const sourcePolicyFailureFormatters: Record<string, FailureFormatter> = {
  eslintDisableWeakReason: (failure) =>
    `${failure.file}:${requiredNumber(failure.line)} uses eslint-disable-next-line without a specific reason after --. Explain the local invariant, not that lint needed bypassing.`,
  pagedCellScan: (failure) =>
    `${failure.file}:${requiredNumber(failure.line)} bypasses collectPagedScan cursor ownership. Do not use CCC findCells/findCellsOnChain generators; call findCellsPaged only from the collectPagedScan page callback.`,
  pagedCellScanPageSize: (failure) =>
    `${failure.file}:${requiredNumber(failure.line)} calls findCellsPaged without page-size and after-cursor named final arguments. Pass both values supplied by collectPagedScan so request size and cursor ownership stay explicit.`,
  publicApiDocumentation: (failure) =>
    `${failure.file}:${requiredNumber(failure.line)} public API ${requiredString(failure.apiName)} has no TSDoc. Public package APIs must document their contract at the declaration that produces the emitted .d.ts surface.`,
  sizeSplitSourceName: (failure) =>
    `${failure.file}: file name ends in a letter or part suffix, so it was split by size rather than by concern. Split by responsibility and name each file after it, or keep one file.`,
  scriptIdentityComparison: (failure) =>
    `${failure.file}:${requiredNumber(failure.line)} compares script.${requiredString(failure.field)} directly. Compare full scripts with .eq(...) or serialized full script identity; codeHash, hashType, and args are one trust boundary.`,
};

const testPolicyFailureFormatters = new Map<string, FailureFormatter>([
  [
    "nonCanonicalTestsDirectory",
    (failure): string =>
      `${failure.file}: tests/ is not allowed. Use the canonical test/ directory so package scripts and source classification have one test path shape.`,
  ],
]);

export function assertNoFailures(output: Failure[]): void {
  if (output.length > 0) {
    throw new Error(
      `Source structure lint failed:\n${output.map(formatFailure).join("\n")}`,
    );
  }
}

function formatFailure(failure: Failure): string {
  return (
    formatRepositoryFailure(failure) ??
    packageFailureFormatters.get(failure.rule)?.(failure) ??
    formatDependencyFailure(failure) ??
    sourcePolicyFailureFormatters[failure.rule]?.(failure) ??
    formatTestPolicyFailure(failure) ??
    formatBuildFailure(failure) ??
    unknownFailure(failure)
  );
}

function formatRepositoryFailure(failure: Failure): string | undefined {
  switch (failure.rule) {
    case "noJavaScriptSource":
      return `${failure.file}: JavaScript source is not allowed in this repo. Convert it to TypeScript with erasable types, rename it to .ts unless a tool requires .mts, and let it run through the normal typecheck and ESLint flow.`;
    case "mtsExtensionPolicy":
      return `${failure.file}: .mts is only for tool config files that require that extension. Rename normal TypeScript scripts, tests, and helpers to .ts.`;
    case "knipJavaScriptReference":
      return `${failure.file}:${requiredNumber(failure.line)} references JavaScript source extensions. Knip must track TypeScript tooling so JavaScript paths cannot hide from unused-code checks.`;
    case "unpinnedWorkflowAction":
      return `${failure.file}:${requiredNumber(failure.line)} uses unpinned workflow action ${requiredString(failure.action)}. Pin GitHub Actions to a full 40-character commit SHA and Docker actions to a sha256 digest.`;
    case "invalidWorkflowYaml":
      return `${failure.file}: invalid workflow YAML: ${requiredString(failure.message)}`;
    case "nestedWorkflowLocation":
      return `${failure.file}: GitHub only discovers workflows under the repository-root .github/workflows directory. Move or delete this inert nested workflow.`;
    case "checkWorkflowPermissions":
      return `${failure.file}: every check workflow job must have effective contents: read permissions and no write permission so dependency tooling cannot receive a privileged token.`;
    case "checkoutCredentialPersistence":
      return `${failure.file}:${requiredNumber(failure.line)} checkout must set persist-credentials: false before running dependency tooling.`;
    case "rootPackageManagerIntegrity":
      return `${failure.file}: packageManager must be an integrity-suffixed pnpm spec, for example pnpm@10.30.3+sha512.<hash>, so CI and local installs use the same package manager.`;
    default:
      return undefined;
  }
}

function formatDependencyFailure(failure: Failure): string | undefined {
  switch (failure.rule) {
    case "workspaceSourceImportDependency":
      return `${failure.file}: production source imports ${requiredString(failure.packageName)}, but ${requiredString(failure.packageFile)} does not declare it in dependencies or peerDependencies. Add a production dependency declaration, or move the import behind test-only source.`;
    case "workspaceTestImportDependency":
      return `${failure.file}: test source imports ${requiredString(failure.packageName)}, but ${requiredString(failure.packageFile)} does not declare it in dependencies, devDependencies, or peerDependencies. Add a package-local dependency declaration for the test import.`;
    default:
      return undefined;
  }
}

function formatTestPolicyFailure(failure: Failure): string | undefined {
  return (
    testPolicyFailureFormatters.get(failure.rule)?.(failure) ??
    formatDetailedTestPolicyFailure(failure)
  );
}

function formatDetailedTestPolicyFailure(failure: Failure): string | undefined {
  switch (failure.rule) {
    case "testSourceLocation":
      return `${failure.file}: test-related source belongs under a test/ directory. Move ${requiredString(failure.target)}, and move helpers to semantic paths such as test/support/foo.ts or test/fixtures/foo.ts.`;
    case "testSourceName":
      return `${failure.file}: test directory already carries the test role. Rename ${requiredString(failure.name)} to a semantic name without .test, Suite, TestFixtures, TestSupport, or _test_* markers.`;
    case "sideEffectOnlySuiteManifest":
      return `${failure.file}: side-effect-only suite manifest. Let Vitest discover suite files directly or add a real test entrypoint with meaningful assertions.`;
    case "loadOnlyTestSuite":
      return `${fileLocation(failure)}: load-only split suite test. Let Vitest discover suite files directly or replace the loader assertion with behavior assertions.`;
    case "complianceOnlyTestSuite":
      return `${fileLocation(failure)}: test assertions only prove the test or module loaded. Replace function-existence, import-count, or no-error-only assertions with behavior assertions, or delete the test.`;
    case "repeatedTestSuiteConstant":
      return `${failure.file}:${requiredNumber(failure.line)} duplicates ${requiredString(failure.name)} across ${requiredNumber(failure.count)} sibling test files. Put shared suite titles in a support/ or fixtures/ module so renames and grouping stay coherent.`;
    case "ordinalTestShardName":
      return `${failure.file}: numbered test shard name hides the behavior boundary. Use a semantic test filename instead of ordinal suite sharding.`;
    case "testRunModifier":
      return `${fileLocation(failure)}: test options must be inline and may not enable fails/retry or hide options behind spreads or dynamic keys. Keep committed tests deterministic and passing.`;
    default:
      return undefined;
  }
}

function formatBuildFailure(failure: Failure): string | undefined {
  switch (failure.rule) {
    case "buildSurfaceConfig":
      return `${failure.file}: invalid package build config: ${requiredString(failure.message)}`;
    case "buildSurfaceTestFile":
      return `${failure.file}: test-only source is included in a publishable package build. Exclude test files and helpers from tsconfig.build.json.`;
    case "buildSurfaceTestImport":
      return `${failure.file}: publishable package build source imports test-only module ${requiredString(failure.specifier)}. Move the import behind a test-only file or split production helpers out of test support.`;
    default:
      return undefined;
  }
}

function requiredNumber(value: number | undefined): string {
  if (value === undefined) {
    throw new Error("Missing numeric failure field");
  }
  return String(value);
}

function fileLocation(failure: Failure): string {
  return failure.line === undefined
    ? failure.file
    : `${failure.file}:${String(failure.line)}`;
}

function requiredString(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Missing string failure field");
  }
  return value;
}

function unknownFailure(failure: Failure): never {
  throw new Error(`Unknown source structure rule ${failure.rule}`);
}
