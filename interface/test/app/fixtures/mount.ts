import type { ReactElement } from "react";
import type { Mock } from "vitest";

interface MountElement {
  id: string;
}

export function element(id: string): MountElement {
  return {
    id,
  };
}

export function renderedElement(
  createRoot: Mock,
): ReactElement<{ children: ReactElement }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- The mocked React root stores the rendered element in Vitest mock call state.
  const rendered = createRoot.mock.results[0]?.value.render.mock.calls[0]?.[0];
  if (rendered === undefined) {
    throw new Error("React root did not render");
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Entrypoint tests inspect the React element passed to the mocked root.
  return rendered as ReactElement<{ children: ReactElement }>;
}
