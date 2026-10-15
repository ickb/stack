import type { ReactElement, ReactNode } from "react";
import { childNodes, isReactElement } from "./reactNode.ts";

export { elementProps } from "./reactNode.ts";

export function childElements(element: ReactElement): ReactElement[] {
  return childNodes(element).filter(isReactElement);
}

export function firstElement(elements: ReactElement[]): ReactElement {
  const element = elements[0];
  if (element === undefined) {
    throw new Error("React element not found");
  }
  return element;
}

export function invokeElement(element: ReactElement): ReactElement {
  if (typeof element.type !== "function") {
    throw new TypeError("React element type is not callable");
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Function component invocation needs the callable React element type.
  const invoke = element.type as (props: unknown) => ReactElement;
  return invoke(element.props);
}

export function findElement(
  element: ReactElement,
  predicate: (element: ReactElement) => boolean,
): ReactElement {
  const found = findElements(element, predicate)[0];
  if (found === undefined) {
    throw new Error("React element not found");
  }
  return found;
}

export function findElements(
  element: ReactElement,
  predicate: (element: ReactElement) => boolean,
): ReactElement[] {
  const found: ReactElement[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- React children arrays are traversed as ReactNode values.
        visit(child);
      }
      return;
    }

    if (!isReactElement(node)) {
      return;
    }

    if (predicate(node)) {
      found.push(node);
    }

    for (const child of childNodes(node)) {
      visit(child);
    }
  };

  visit(element);
  return found;
}
