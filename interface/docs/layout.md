# Layout

Views keep the order form, action, chart. Putting the chart between the form and its button pushed the action below the fold. Reserved section heights keep feedback from moving the controls. Accent color marks actionable elements, not inert balances.

The app loads in one piece: the landing quote already needs the SDK, so a lazy shell would add a serial load without a useful boundary.

## Snapshots

Markup snapshots pin the look itself (the classes, inline positions, connector theme) of:

- the chart;
- the action section;
- the form states;
- the testnet hint;
- the connector props.

A mutation test showed each of those strings unchecked. A snapshot fails on any of them with one assertion. Asserting each class would restate the markup in the tests. Marking the strings as untestable would be false.

A deliberate design change accepts the cost: update the snapshots with `vitest -u`, then review their diff.
