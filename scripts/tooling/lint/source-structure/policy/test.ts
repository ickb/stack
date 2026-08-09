import ts from "typescript";
import type { Failure, SourcesByFile } from "../model.ts";
import {
  compareStrings,
  directoryOf,
  isSideEffectImport,
  isTestSuiteSource,
  isTestSupportSource,
  lineOf,
  parseSource,
  propertyNameText,
  visit,
} from "../repository.ts";
import { callMethodName, expressionName } from "./common.ts";

interface SuiteConstantUse {
  directory: string;
  file: string;
  line: number;
  name: string;
}

const complianceOnlyTypeNames = new Set(["function", "object"]);
const noErrorOnlyAssertionNames = new Set([
  "assert.doesNotReject",
  "assert.doesNotThrow",
  "assert.ifError",
]);
const assertEqualName = "assert.equal";
const expectReceiverName = "expect";
const expectReceiverPrefix = `${expectReceiverName}.`;
const testRegistrationKinds: ReadonlyMap<string, "case" | "suite"> = new Map([
  ["describe", "suite"],
  ["suite", "suite"],
  ["it", "case"],
  ["test", "case"],
]);

export function checkTestPolicyRules(sources: SourcesByFile, output: Failure[]): void {
  checkRepeatedTestSuiteConstants(sources, output);
  for (const [file, source] of sources) {
    if (!isExecutableTestFile(file)) {
      continue;
    }
    const sourceFile = parseSource(file, source);
    checkSideEffectOnlySuiteManifest(file, sourceFile, output);
    checkTestRunModifiers(file, sourceFile, output);
    checkWeakTestAssertions(file, sourceFile, output);
  }
}

const reservedTestOptionNames = new Set(["fails", "retry"]);

function checkTestRunModifiers(
  file: string,
  sourceFile: ts.SourceFile,
  output: Failure[],
): void {
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isRootTestRegistrationCall(node)) {
      return;
    }
    const [, options, callback] = node.arguments;
    if (options === undefined || callback === undefined || isInlineFunction(options)) {
      return;
    }
    const unwrappedOptions = unwrapTestOptions(options);
    if (
      (ts.isObjectLiteralExpression(unwrappedOptions) &&
        hasUnsafeTestOptions(unwrappedOptions)) ||
      (!ts.isObjectLiteralExpression(unwrappedOptions) && isInlineFunction(callback))
    ) {
      output.push({ rule: "testRunModifier", file, line: lineOf(sourceFile, node) });
    }
  });
}

function unwrapTestOptions(options: ts.Expression): ts.Expression {
  let current = options;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isRootTestRegistrationCall(node: ts.CallExpression): boolean {
  const root = expressionRootName(node.expression);
  return root !== undefined && testRegistrationKinds.has(root);
}

function hasUnsafeTestOptions(options: ts.ObjectLiteralExpression): boolean {
  return options.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) {
      return true;
    }
    if (
      ts.isComputedPropertyName(property.name) &&
      !ts.isStringLiteral(property.name.expression)
    ) {
      return true;
    }
    const name =
      ts.isComputedPropertyName(property.name) &&
      ts.isStringLiteral(property.name.expression)
        ? property.name.expression.text
        : propertyNameText(property.name);
    if (!reservedTestOptionNames.has(name)) {
      return false;
    }
    return !(
      ts.isPropertyAssignment(property) &&
      (property.initializer.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isNumericLiteral(property.initializer) && property.initializer.text === "0"))
    );
  });
}

function isExecutableTestFile(file: string): boolean {
  return isTestSuiteSource(file) && !isTestSupportSource(file);
}

function checkSideEffectOnlySuiteManifest(
  file: string,
  sourceFile: ts.SourceFile,
  output: Failure[],
): void {
  if (
    sourceFile.statements.length > 0 &&
    sourceFile.statements.every((statement) => isSideEffectImport(statement))
  ) {
    output.push({ rule: "sideEffectOnlySuiteManifest", file });
  }
}

function checkWeakTestAssertions(
  file: string,
  sourceFile: ts.SourceFile,
  output: Failure[],
): void {
  const testScopes = testAssertionScopes(sourceFile);
  if (testScopes.length > 0) {
    for (const testScope of testScopes) {
      checkWeakAssertionScope(file, testScope.assertions, output, testScope.line);
    }
    return;
  }

  const assertions = assertionCalls(sourceFile);
  checkWeakAssertionScope(file, assertions, output);
}

interface TestAssertionScope {
  assertions: ts.CallExpression[];
  line: number;
}

function testAssertionScopes(sourceFile: ts.SourceFile): TestAssertionScope[] {
  const scopes: TestAssertionScope[] = [];
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isTestCaseCall(node)) {
      return;
    }
    const callback = node.arguments.find(isInlineFunction);
    if (callback === undefined) {
      return;
    }
    scopes.push({ assertions: assertionCalls(callback), line: lineOf(sourceFile, node) });
  });
  return scopes;
}

function isTestCaseCall(node: ts.CallExpression): boolean {
  const root = expressionRootName(node.expression);
  return root === "it" || root === "test" || callMethodName(node) === "test";
}

function expressionRootName(node: ts.Expression): string | undefined {
  let current = node;
  while (ts.isCallExpression(current)) {
    current = current.expression;
  }
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function isInlineFunction(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function checkWeakAssertionScope(
  file: string,
  assertions: ts.CallExpression[],
  output: Failure[],
  line?: number,
): void {
  if (assertions.length === 0) {
    return;
  }
  if (assertions.every(isLoadOnlyAssertion)) {
    output.push({ rule: "loadOnlyTestSuite", file, line });
    return;
  }
  if (assertions.every(isComplianceOnlyAssertion)) {
    output.push({ rule: "complianceOnlyTestSuite", file, line });
  }
}

function assertionCalls(node: ts.Node): ts.CallExpression[] {
  const assertions: ts.CallExpression[] = [];
  collectAssertionCalls(node, node, assertions);
  return assertions;
}

function collectAssertionCalls(
  root: ts.Node,
  current: ts.Node,
  assertions: ts.CallExpression[],
): void {
  if (current !== root && ts.isCallExpression(current) && isTestCaseCall(current)) {
    return;
  }
  if (ts.isCallExpression(current) && isAssertionCall(current)) {
    assertions.push(current);
  }
  ts.forEachChild(current, (child) => {
    collectAssertionCalls(root, child, assertions);
  });
}

function isAssertionCall(node: ts.CallExpression): boolean {
  const callee = expressionName(node.expression);
  return callee.startsWith("assert.") || isExpectMatcherCall(node.expression);
}

function isExpectMatcherCall(node: ts.Expression): boolean {
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  if (!ts.isCallExpression(current)) {
    return false;
  }
  const receiver = expressionName(current.expression);
  return receiver === expectReceiverName || receiver.startsWith(expectReceiverPrefix);
}

function isLoadOnlyAssertion(node: ts.CallExpression): boolean {
  const callee = expressionName(node.expression);
  if (callee === "assert.ok") {
    return isTrueLiteral(node.arguments[0]);
  }
  if (callee === assertEqualName) {
    return isTrueLiteral(node.arguments[0]) && isTrueLiteral(node.arguments[1]);
  }
  return isExpectTrueToBeTrue(node);
}

function isExpectTrueToBeTrue(node: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "toBe"
  ) {
    return false;
  }
  const receiver = node.expression.expression;
  return (
    ts.isCallExpression(receiver) &&
    expressionName(receiver.expression) === expectReceiverName &&
    isTrueLiteral(receiver.arguments[0]) &&
    isTrueLiteral(node.arguments[0])
  );
}

function isTrueLiteral(node: ts.Expression | undefined): boolean {
  return node?.kind === ts.SyntaxKind.TrueKeyword;
}

function isComplianceOnlyAssertion(node: ts.CallExpression): boolean {
  const text = node.getText();
  return (
    isLoadOnlyAssertion(node) ||
    isAssertEqualTypeof(node) ||
    isNoErrorOnlyAssertion(node) ||
    isExpectTypeofToBe(node) ||
    isExpectToBeTypeOf(node) ||
    /expect\([^)]*\.length\)\.(?:toBeGreaterThan|toEqual|toBe)\(/u.test(text)
  );
}

function isAssertEqualTypeof(node: ts.CallExpression): boolean {
  return (
    expressionName(node.expression) === assertEqualName &&
    isTypeofExpression(node.arguments[0]) &&
    isComplianceOnlyTypeName(node.arguments[1])
  );
}

function isNoErrorOnlyAssertion(node: ts.CallExpression): boolean {
  return noErrorOnlyAssertionNames.has(expressionName(node.expression));
}

function isExpectTypeofToBe(node: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "toBe" ||
    !isComplianceOnlyTypeName(node.arguments[0])
  ) {
    return false;
  }
  const receiver = node.expression.expression;
  return isExpectCall(receiver) && isTypeofExpression(receiver.arguments[0]);
}

function isExpectToBeTypeOf(node: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "toBeTypeOf" ||
    !isComplianceOnlyTypeName(node.arguments[0])
  ) {
    return false;
  }
  return isExpectCall(node.expression.expression);
}

function isExpectCall(node: ts.Expression): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const receiver = expressionName(node.expression);
  return receiver === expectReceiverName || receiver.startsWith(expectReceiverPrefix);
}

function isTypeofExpression(node: ts.Expression | undefined): boolean {
  return node !== undefined && ts.isTypeOfExpression(node);
}

function isComplianceOnlyTypeName(node: ts.Expression | undefined): boolean {
  const value = stringLiteralValue(node);
  return value !== undefined && complianceOnlyTypeNames.has(value);
}

function stringLiteralValue(node: ts.Expression | undefined): string | undefined {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function checkRepeatedTestSuiteConstants(
  sources: SourcesByFile,
  output: Failure[],
): void {
  const usesByDirectoryAndName = new Map<string, SuiteConstantUse[]>();
  for (const [file, source] of sources) {
    if (!isExecutableTestFile(file)) {
      continue;
    }
    const sourceFile = parseSource(file, source);
    for (const suiteConstant of suiteConstants(sourceFile, file)) {
      const key = `${suiteConstant.directory}:${suiteConstant.name}`;
      const uses = usesByDirectoryAndName.get(key) ?? [];
      uses.push(suiteConstant);
      usesByDirectoryAndName.set(key, uses);
    }
  }

  for (const uses of usesByDirectoryAndName.values()) {
    const siblingCount = new Set(uses.map((use) => use.file)).size;
    if (siblingCount < 2) {
      continue;
    }
    for (const use of uses.toSorted((left, right) =>
      compareStrings(left.file, right.file),
    )) {
      output.push({
        rule: "repeatedTestSuiteConstant",
        file: use.file,
        line: use.line,
        name: use.name,
        count: siblingCount,
      });
    }
  }
}

function suiteConstants(sourceFile: ts.SourceFile, file: string): SuiteConstantUse[] {
  const stringConstants = topLevelStringConstants(sourceFile);
  const constants: SuiteConstantUse[] = [];
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isRootTestSuiteCall(node)) {
      return;
    }
    const title = node.arguments[0];
    if (
      title === undefined ||
      !ts.isIdentifier(title) ||
      !stringConstants.has(title.text)
    ) {
      return;
    }
    constants.push({
      directory: directoryOf(file),
      file,
      line: lineOf(sourceFile, title),
      name: title.text,
    });
  });
  return constants;
}

function isRootTestSuiteCall(node: ts.CallExpression): boolean {
  const root = expressionRootName(node.expression);
  return root !== undefined && testRegistrationKinds.get(root) === "suite";
}

function topLevelStringConstants(sourceFile: ts.SourceFile): Set<string> {
  const constants = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        stringLiteralLike(declaration.initializer)
      ) {
        constants.add(declaration.name.text);
      }
    }
  }
  return constants;
}

function stringLiteralLike(node: ts.Expression | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}
