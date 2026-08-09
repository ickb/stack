import ts from "typescript";
import type { Failure, PublicNamesByFile, SourcesByFile } from "./model.ts";
import {
  compareStrings,
  hasExportModifier,
  lineOf,
  moduleSpecifierText,
  normalizePath,
  parseSource,
  propertyNameText,
  resolveLocalSourceModule,
  type Node,
  type NodeArray,
  type Statement,
} from "./repository.ts";

type ClassDeclaration = ts.ClassDeclaration;
type ClassElement = ts.ClassElement;
type ConstructorDeclaration = ts.ConstructorDeclaration;
type ExportDeclaration = ts.ExportDeclaration;
type GetAccessorDeclaration = ts.GetAccessorDeclaration;
type MethodDeclaration = ts.MethodDeclaration;
type PropertyDeclaration = ts.PropertyDeclaration;
type SetAccessorDeclaration = ts.SetAccessorDeclaration;
type TypeElement = ts.TypeElement;
type VariableDeclaration = ts.VariableDeclaration;
type VariableStatement = ts.VariableStatement;

interface PublicDocContext {
  file: string;
  output: Failure[];
  sourceFile: ts.SourceFile;
}

interface PublicExportContext {
  output: PublicNamesByFile;
  sourceFileSet: Set<string>;
  sources: SourcesByFile;
  stack: Set<string>;
}

interface DirectPublicExportContext {
  file: string;
  localExportNames: Set<string>;
  output: PublicNamesByFile;
  requestedNames: Set<string> | undefined;
}

type PublicApiClassMember =
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | MethodDeclaration
  | PropertyDeclaration
  | SetAccessorDeclaration;

type PublicVariableDeclaration = VariableDeclaration & { name: ts.Identifier };

export function collectPublicApiNames(
  sources: SourcesByFile,
  roots: string[],
  sourceFileSet: Set<string>,
): PublicNamesByFile {
  const namesByFile: PublicNamesByFile = new Map();
  const context = {
    output: namesByFile,
    sourceFileSet,
    sources,
    stack: new Set<string>(),
  };
  for (const packageRoot of roots) {
    const entrypoint = normalizePath(`${packageRoot}/src/index.ts`);
    collectPublicExportsFromFile(entrypoint, undefined, context);
  }
  return namesByFile;
}

function collectPublicExportsFromFile(
  file: string,
  requestedNames: Set<string> | undefined,
  context: PublicExportContext,
): void {
  const normalizedFile = normalizePath(file);
  const visitKey = `${normalizedFile}:${sortedRequestedNames(requestedNames)}`;
  if (context.stack.has(visitKey)) {
    return;
  }
  context.stack.add(visitKey);

  const source = context.sources.get(normalizedFile);
  if (source === undefined) {
    return;
  }
  const sourceFile = parseSource(normalizedFile, source);
  const localExportNames = localExportNamesFrom(sourceFile, requestedNames);
  const directContext = {
    file: normalizedFile,
    localExportNames,
    output: context.output,
    requestedNames,
  };
  for (const statement of sourceFile.statements) {
    collectDirectPublicExports(directContext, statement);
  }

  for (const statement of sourceFile.statements) {
    collectReExportedPublicNames(normalizedFile, statement, requestedNames, context);
  }
}

function collectDirectPublicExports(
  context: DirectPublicExportContext,
  statement: Statement,
): void {
  const name = declarationName(statement);
  if (name !== undefined && isDirectPublicExport(context, statement, name)) {
    addPublicApiName(context.output, context.file, name);
    return;
  }
  if (ts.isVariableStatement(statement)) {
    collectPublicVariableNames(context, statement);
  }
}

function collectPublicVariableNames(
  context: DirectPublicExportContext,
  statement: VariableStatement,
): void {
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      isDirectPublicExport(context, statement, declaration.name.text)
    ) {
      addPublicApiName(context.output, context.file, declaration.name.text);
    }
  }
}

function isDirectPublicExport(
  context: DirectPublicExportContext,
  statement: Statement,
  name: string,
): boolean {
  return (
    (hasExportModifier(statement) && nameRequested(name, context.requestedNames)) ||
    context.localExportNames.has(name)
  );
}

function collectReExportedPublicNames(
  file: string,
  statement: Statement,
  requestedNames: Set<string> | undefined,
  context: PublicExportContext,
): void {
  if (!ts.isExportDeclaration(statement)) {
    return;
  }
  const target = localReExportTarget(file, statement, context.sourceFileSet);
  if (target === undefined) {
    return;
  }
  const targetNames = reExportTargetNames(statement, requestedNames);
  if (targetNames === undefined || targetNames.size > 0) {
    collectPublicExportsFromFile(target, targetNames, context);
  }
}

function localReExportTarget(
  file: string,
  statement: ExportDeclaration,
  sourceFileSet: Set<string>,
): string | undefined {
  const specifier = moduleSpecifierText(statement);
  if (specifier?.startsWith(".") !== true) {
    return undefined;
  }
  return resolveLocalSourceModule(file, specifier, sourceFileSet);
}

function reExportTargetNames(
  statement: ExportDeclaration,
  requestedNames: Set<string> | undefined,
): Set<string> | undefined {
  if (statement.exportClause === undefined) {
    return undefined;
  }
  if (!ts.isNamedExports(statement.exportClause)) {
    return new Set();
  }
  const targetNames = new Set<string>();
  for (const element of statement.exportClause.elements) {
    const exportedName = element.name.text;
    if (nameRequested(exportedName, requestedNames)) {
      targetNames.add((element.propertyName ?? element.name).text);
    }
  }
  return targetNames;
}

function localExportNamesFrom(
  sourceFile: ts.SourceFile,
  requestedNames: Set<string> | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (nameRequested(element.name.text, requestedNames)) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

function nameRequested(name: string, requestedNames: Set<string> | undefined): boolean {
  return requestedNames === undefined || requestedNames.has(name);
}

function sortedRequestedNames(requestedNames: Set<string> | undefined): string {
  return requestedNames === undefined
    ? "*"
    : [...requestedNames].toSorted(compareStrings).join(",");
}

function addPublicApiName(output: PublicNamesByFile, file: string, name: string): void {
  const names = output.get(file) ?? new Set<string>();
  names.add(name);
  output.set(file, names);
}

function declarationName(statement: Statement): string | undefined {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return statement.name.text;
  }
  return undefined;
}

export function checkPublicApiDocumentation(
  file: string,
  source: string,
  publicNamesByFile: PublicNamesByFile,
  output: Failure[],
): void {
  const publicNames = publicNamesByFile.get(normalizePath(file));
  if (publicNames === undefined) {
    return;
  }

  const sourceFile = parseSource(file, source);
  const context = { file, output, sourceFile };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      checkPublicVariableDocumentation(context, statement, publicNames);
      continue;
    }

    const name = declarationName(statement);
    if (name === undefined || !publicNames.has(name)) {
      continue;
    }

    requirePublicApiDoc(context, statement, name);
    if (ts.isClassDeclaration(statement)) {
      checkPublicClassMemberDocumentation(context, name, statement);
      continue;
    }
    if (ts.isInterfaceDeclaration(statement)) {
      checkPublicTypeMemberDocumentation(context, name, statement.members);
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      checkPublicTypeMemberDocumentation(context, name, statement.type.members);
    }
  }
}

function checkPublicVariableDocumentation(
  context: PublicDocContext,
  statement: VariableStatement,
  publicNames: Set<string>,
): void {
  const publicDeclarations = statement.declarationList.declarations.filter(
    (declaration): declaration is PublicVariableDeclaration =>
      ts.isIdentifier(declaration.name) && publicNames.has(declaration.name.text),
  );
  if (publicDeclarations.length === 0 || hasJsDoc(statement)) {
    return;
  }
  for (const declaration of publicDeclarations) {
    context.output.push({
      rule: "publicApiDocumentation",
      file: context.file,
      line: lineOf(context.sourceFile, declaration),
      apiName: declaration.name.text,
    });
  }
}

function checkPublicClassMemberDocumentation(
  context: PublicDocContext,
  className: string,
  declaration: ClassDeclaration,
): void {
  for (const member of declaration.members) {
    if (isPublicApiClassMember(member)) {
      requirePublicApiDoc(context, member, `${className}.${classMemberName(member)}`);
    }
  }
}

function checkPublicTypeMemberDocumentation(
  context: PublicDocContext,
  typeName: string,
  members: NodeArray<TypeElement>,
): void {
  for (const member of members) {
    requirePublicApiDoc(context, member, `${typeName}.${typeMemberName(member)}`);
  }
}

function requirePublicApiDoc(
  context: PublicDocContext,
  node: Node,
  apiName: string,
): void {
  if (!hasJsDoc(node)) {
    context.output.push({
      rule: "publicApiDocumentation",
      file: context.file,
      line: lineOf(context.sourceFile, node),
      apiName,
    });
  }
}

function hasJsDoc(node: Node): boolean {
  return ts
    .getJSDocCommentsAndTags(node)
    .some((comment) => comment.kind === ts.SyntaxKind.JSDoc);
}

function isPublicApiClassMember(member: ClassElement): member is PublicApiClassMember {
  if (!(
    ts.isConstructorDeclaration(member) ||
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member) ||
    ts.isPropertyDeclaration(member)
  )) {
    return false;
  }
  return (
    member.modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    ) !== true
  );
}

function classMemberName(member: PublicApiClassMember): string {
  return ts.isConstructorDeclaration(member)
    ? "constructor"
    : propertyNameText(member.name);
}

function typeMemberName(member: TypeElement): string {
  return "name" in member && member.name !== undefined
    ? propertyNameText(member.name)
    : "<signature>";
}
