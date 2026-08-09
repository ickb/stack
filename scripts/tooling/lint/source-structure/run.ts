import { assertNoFailures } from "./format.ts";
import { publishablePackageRoots, type Failure, type SourcesByFile } from "./model.ts";
import {
  checkPackageRootCoverage,
  checkPackageScriptReferences,
  checkRootPackageManagerIntegrity,
  checkWorkspaceDependencyDeclarations,
  collectPackageMetadata,
  collectPackageScripts,
} from "./packages.ts";
import { checkSourcePolicyRules } from "./policy/source.ts";
import { checkTestPolicyRules } from "./policy/test.ts";
import { checkPublicApiDocumentation, collectPublicApiNames } from "./public-api.ts";
import {
  checkKnipJavaScriptReferences,
  checkMtsExtensionPolicy,
  checkNoJavaScriptFiles,
  checkWorkflowLocations,
  checkWorkflowPolicy,
  compareStrings,
  isSourceFile,
  normalizePath,
  ownedRepositoryFiles,
  readText,
  workflowFiles,
} from "./repository.ts";
import { checkBuildSurface } from "./source.ts";

export async function runSourceStructureLint(): Promise<void> {
  const output: Failure[] = [];
  const files = await ownedRepositoryFiles();
  const sources = await collectSources(files);
  const sourceFileSet = new Set(sources.keys());
  const packageScripts = await collectPackageScripts(files);
  const packageMetadata = await collectPackageMetadata(files);
  const publicNamesByFile = collectPublicApiNames(
    sources,
    publishablePackageRoots,
    sourceFileSet,
  );
  checkNoJavaScriptFiles(files, output);
  checkMtsExtensionPolicy(files, output);
  await checkKnipJavaScriptReferences(output);
  const workflows = workflowFiles(files);
  checkWorkflowLocations(workflows, output);
  await checkWorkflowPolicy(workflows, output);
  checkPackageScriptReferences(packageScripts, output);
  checkRootPackageManagerIntegrity(packageScripts, output);
  checkPackageRootCoverage(packageMetadata, output);
  checkWorkspaceDependencyDeclarations(packageScripts, sources, output);
  checkSourcePolicyRules(sources, output);
  checkTestPolicyRules(sources, output);

  for (const [file, source] of sources) {
    checkPublicApiDocumentation(file, source, publicNamesByFile, output);
  }
  for (const root of publishablePackageRoots) {
    checkBuildSurface(root, output);
  }

  assertNoFailures(output);
}

async function collectSources(files: string[]): Promise<SourcesByFile> {
  const sources: SourcesByFile = new Map();
  const sourceFiles = files
    .filter(isSourceFile)
    .map(normalizePath)
    .toSorted(compareStrings);
  for (const file of sourceFiles) {
    sources.set(file, await readText(file));
  }
  return sources;
}
