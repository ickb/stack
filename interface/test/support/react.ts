import { isValidElement, type ReactElement, type ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Call sites provide the prop shape being inspected.
export function elementProps<T>(element: ReactElement): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React element tests intentionally inspect props.
  return element.props as T;
}

/** Every node an element carries in its props: `children` and the slots a page names. */
export function childNodes(element: ReactElement): ReactNode[] {
  const props = elementProps<Record<string, unknown>>(element);
  return Object.values(props).flatMap((value): ReactNode[] => {
    if (Array.isArray(value)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- React children arrays come from ReactElement props.
      return value;
    }
    return isValidElement(value) || typeof value === "string" ? [value] : [];
  });
}

export function childElements(element: ReactElement): ReactElement[] {
  return childNodes(element).filter(isValidElement);
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

    if (!isValidElement(node)) {
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
