/**
 * Reports public class members that no production file references, the gap knip leaves
 * (it sees exports, not members). Two programs, since the interface has its own tsconfig;
 * tests and scripts count neither as declarations nor as references.
 *
 * A reference is any property access or destructuring resolved by the checker to a member
 * of the same name on the class, on a type in its `implements` clause, or on an interface
 * sharing the class's name (the `Info`/`Ratio` const-class pattern, where callers see the
 * interface). Members that override a base type's member are exempt: they are reached
 * through the base.
 */
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const configs = ["tsconfig.json", "interface/tsconfig.json"];
// The testkit serves tests, so its members are theirs to reference; it is left out whole.
const isProduction = (file: string): boolean =>
  ["/test/", "/testkit/", "/scripts/", "/node_modules/"].every(
    (part) => !file.includes(part),
  );

const references = new Set<string>();
const members: Array<{ key: string; where: string }> = [];
for (const config of configs) {
  const parsed = ts.getParsedCommandLineOfConfigFile(config, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (parsed === undefined) {
    throw new Error(`Cannot read ${config}`);
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    if (
      !isProduction(source.fileName) ||
      program.isSourceFileFromExternalLibrary(source)
    ) {
      continue;
    }
    visit(source, checker, source, references, members);
  }
}

const dead = members.filter(({ key }) =>
  key.split("|").every((owner) => !references.has(owner)),
);
for (const { where } of dead) {
  console.error(`Unreferenced public member: ${where}`);
}
process.exitCode = dead.length === 0 ? 0 : 1;

function visit(
  node: ts.Node,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  refs: Set<string>,
  found: Array<{ key: string; where: string }>,
): void {
  if (ts.isPropertyAccessExpression(node)) {
    record(checker.getSymbolAtLocation(node.name), refs);
  } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
    record(checker.getSymbolAtLocation(node.propertyName ?? node.name), refs);
  } else if (ts.isClassLike(node) && node.name !== undefined) {
    collect(node, node.name.text, checker, source, found);
  }
  ts.forEachChild(node, (child) => {
    visit(child, checker, source, refs, found);
  });
}

/**
 * Records the member as `Owner.name` for each of its declarations. The owner is the nearest
 * named class, interface, type alias or variable: a const-class's statics are declared on
 * the type literal of `export const Ratio: {...}`, so the variable names them.
 */
function record(symbol: ts.Symbol | undefined, refs: Set<string>): void {
  for (const declaration of symbol?.declarations ?? []) {
    let owner: ts.Node = declaration.parent;
    while (!ts.isSourceFile(owner)) {
      if (
        (ts.isClassLike(owner) ||
          ts.isInterfaceDeclaration(owner) ||
          ts.isTypeAliasDeclaration(owner) ||
          ts.isVariableDeclaration(owner)) &&
        owner.name !== undefined &&
        ts.isIdentifier(owner.name)
      ) {
        refs.add(`${owner.name.text}.${symbol?.name ?? ""}`);
        break;
      }
      owner = owner.parent;
    }
  }
}

function collect(
  node: ts.ClassLikeDeclaration,
  className: string,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  found: Array<{ key: string; where: string }>,
): void {
  const bases = (node.heritageClauses ?? []).flatMap((clause) =>
    clause.types.map((type) => ({
      name: type.expression.getText(),
      type: checker.getTypeAtLocation(type),
      isExtends: clause.token === ts.SyntaxKind.ExtendsKeyword,
    })),
  );
  for (const member of node.members) {
    const name = member.name;
    if (
      name === undefined ||
      !ts.isIdentifier(name) ||
      ts.isConstructorDeclaration(member)
    ) {
      continue;
    }
    const modifiers = ts.getCombinedModifierFlags(member);
    const isPublic =
      (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
    const isOverride = bases.some(
      ({ type, isExtends }) => isExtends && type.getProperty(name.text) !== undefined,
    );
    if (!isPublic || isOverride || ts.isPrivateIdentifier(name)) {
      continue;
    }
    const owners = [className, ...bases.map(({ name: base }) => base)];
    const line = source.getLineAndCharacterOfPosition(member.getStart()).line + 1;
    const where = `${path.relative(process.cwd(), source.fileName)}:${String(line)} ${className}.${name.text}`;
    // One entry per owner alias: a reference through any of them keeps the member.
    found.push({
      key: owners.map((owner) => `${owner}.${name.text}`).join("|"),
      where,
    });
  }
}
