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

export function isReactElement(value: ReactNode): value is ReactElement {
  return isValidElement(value);
}
