import ts from "typescript";

export function callMethodName(node: ts.CallExpression): string | undefined {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  if (
    ts.isElementAccessExpression(node.expression) &&
    ts.isStringLiteral(node.expression.argumentExpression)
  ) {
    return node.expression.argumentExpression.text;
  }
  return undefined;
}

export function expressionName(node: ts.Expression): string {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const target = expressionName(node.expression);
    return target === "" ? node.name.text : `${target}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    const target = expressionName(node.expression);
    return target === ""
      ? node.argumentExpression.text
      : `${target}.${node.argumentExpression.text}`;
  }
  return "";
}
