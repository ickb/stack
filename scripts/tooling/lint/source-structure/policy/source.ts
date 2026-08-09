import pathModule from "node:path";
import ts from "typescript";
import {
  scriptEqualityOperators,
  scriptIdentityFields,
  weakEslintDisableReasons,
  type Failure,
  type SourcesByFile,
} from "../model.ts";
import {
  isProductionSource,
  isTestRelatedSourceName,
  isUnderNonCanonicalTestsDirectory,
  isUnderTestDirectory,
  lineOf,
  normalizePath,
  parseSource,
  visit,
  type Node,
} from "../repository.ts";
import { callMethodName, expressionName } from "./common.ts";

const { sep } = pathModule;

export function checkSourcePolicyRules(sources: SourcesByFile, output: Failure[]): void {
  for (const [file, source] of sources) {
    const sourceFile = parseSource(file, source);
    checkEslintDisableWeakReason(file, source, output);
    checkSourcePathPolicy(file, output);
    checkScriptIdentityComparison(file, sourceFile, output);
    checkPagedCellScans(file, sourceFile, output);
  }
}

function checkEslintDisableWeakReason(
  file: string,
  source: string,
  output: Failure[],
): void {
  for (const [index, line] of source.split("\n").entries()) {
    const directiveMatch = /^\s*\/\/\s*eslint-disable-next-line\b/u.exec(line);
    if (directiveMatch === null) {
      continue;
    }
    const reasonIndex = line.indexOf("--", directiveMatch.index);
    const reason = reasonIndex === -1 ? "" : line.slice(reasonIndex + 2).trim();
    if (weakEslintReason(reason)) {
      output.push({ rule: "eslintDisableWeakReason", file, line: index + 1 });
    }
  }
}

function weakEslintReason(reason: string): boolean {
  const normalized = trimTrailingPeriods(reason.toLowerCase()).trim();
  return normalized === "" || weakEslintDisableReasons.has(normalized);
}

function trimTrailingPeriods(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === ".") {
    end -= 1;
  }
  return value.slice(0, end);
}

function checkSourcePathPolicy(file: string, output: Failure[]): void {
  const normalized = normalizePath(file);
  const name = normalized.split(sep).at(-1) ?? normalized;
  if (isUnderNonCanonicalTestsDirectory(normalized)) {
    output.push({ rule: "nonCanonicalTestsDirectory", file });
  }
  if (isTestRelatedSourceName(name) && !isUnderTestDirectory(normalized)) {
    output.push({ rule: "testSourceLocation", file, target: name });
  }
  if (isUnderTestDirectory(normalized) && isTestRelatedSourceName(name)) {
    output.push({ rule: "testSourceName", file, name });
  }
  if (isOrdinalTestShardName(name)) {
    output.push({ rule: "ordinalTestShardName", file });
  }
}

function isOrdinalTestShardName(name: string): boolean {
  return /(?:^|[-_])(?:case|part|shard|suite)[-_]?\d+\.(?:ts|tsx)$/iu.test(name);
}

function checkScriptIdentityComparison(
  file: string,
  sourceFile: ts.SourceFile,
  output: Failure[],
): void {
  visit(sourceFile, (node) => {
    if (
      !ts.isBinaryExpression(node) ||
      !scriptEqualityOperators.has(node.operatorToken.kind)
    ) {
      return;
    }
    const field = scriptIdentityField(node.left) ?? scriptIdentityField(node.right);
    if (field !== undefined) {
      output.push({
        rule: "scriptIdentityComparison",
        file,
        line: lineOf(sourceFile, node),
        field,
      });
    }
  });
}

function scriptIdentityField(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node) && scriptIdentityFields.has(node.name.text)) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    scriptIdentityFields.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function checkPagedCellScans(
  file: string,
  sourceFile: ts.SourceFile,
  output: Failure[],
): void {
  if (!isProductionSource(file)) {
    return;
  }
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const method = callMethodName(node);
    if (
      (method === "findCells" &&
        !expressionName(node.expression).includes(".cache.findCells")) ||
      method === "findCellsOnChain"
    ) {
      output.push({ rule: "pagedCellScan", file, line: lineOf(sourceFile, node) });
      return;
    }
    if (method !== "findCellsPaged") {
      return;
    }
    if (!hasCollectPagedScanAncestor(node)) {
      output.push({ rule: "pagedCellScan", file, line: lineOf(sourceFile, node) });
      return;
    }
    if (!hasPagingArguments(node)) {
      output.push({
        rule: "pagedCellScanPageSize",
        file,
        line: lineOf(sourceFile, node),
      });
    }
  });
}

function hasCollectPagedScanAncestor(node: Node): boolean {
  let current: Node = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isCallExpression(current) &&
      expressionName(current.expression) === "collectPagedScan"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function hasPagingArguments(node: ts.CallExpression): boolean {
  const pageSizeArgument = node.arguments.at(-2);
  const afterArgument = node.arguments.at(-1);
  return (
    pageSizeArgument !== undefined &&
    /pageSize/iu.test(expressionName(pageSizeArgument)) &&
    afterArgument !== undefined &&
    /after|cursor/iu.test(expressionName(afterArgument))
  );
}
