# iCKB/Testkit

Private workspace test helpers for iCKB packages and apps.

`@ickb/testkit` provides compact constructors and fixtures for tests that need CCC-compatible scripts, byte strings, headers, cells, and related values. It is not a runtime dependency and is not published.

## Client doubles

`StubClient` supplies scripted responses. `pagedCells` adapts a cell list to the paging shape the SDK reads. Stateful tests own their response maps explicitly; the kit does not simulate a chain, filter a second order book or maintain another transaction lifecycle.

The composed client also preserves coverage of clients that are not `ClientJsonRpc` instances. CCC's connector wraps its client through composition, so that runtime identity is a real consumer path rather than a convenience invented for tests. Consumers needing real completion use the actual builders with stubbed chain responses, not builders that return their input unchanged.

## Contract oracle

`src/contract_oracle.ts` models the on-chain rules independently of the SDK. Its dependency-cruiser rule prevents imports from the implementation under test; source pins and transcription rationale stay at the oracle. Shared constructors may make fixtures smaller, but expected results must not come from the same implementation they check.
