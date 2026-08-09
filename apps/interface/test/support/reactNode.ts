import { isValidElement, type ReactElement, type ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Call sites provide the prop shape being inspected.
export function elementProps<T>(element: ReactElement): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- React element tests intentionally inspect props.
  return element.props as T;
}

export function childNodes(element: ReactElement): ReactNode[] {
  const { children } = elementProps<{ children?: ReactNode }>(element);
  if (children === undefined || children === null) {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- React children arrays come from ReactElement props.
  return Array.isArray(children) ? children : [children];
}

export function isReactElement(value: ReactNode): value is ReactElement {
  return isValidElement(value);
}
