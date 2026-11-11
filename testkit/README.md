# iCKB Test Kit

Small test helpers for every iCKB workspace: constructors for CCC scripts, bytes, headers, cells and clients. `@ickb/testkit` is private. It's never a runtime dependency.

## Client doubles

`StubClient` answers from scripted handlers, so a test stubs one typed method, not the wire. A handler such as `getTipHeader` replaces that client method. Three handlers serve the raw reads of the SDK instead:

- **`cells`:** serves the raw `get_cells` the SDK scan reads, page by page. A cell may name its block, otherwise it sits in block 0.
- **`transactions`:** serves the raw `get_transactions` the same way.
- **`transactionStatus`:** answers the status-only `get_transaction`.

Header 0 is the real testnet genesis, since the stub is a testnet client and completion reads its chain there. `GENESIS_HEADERS` / `genesisHeader` carry the genesis headers of both chains as their public nodes answered, for a test that scripts its own header reads. Any other request that reaches the wire fails offline.

Stateful tests own their response maps. The kit doesn't simulate a chain, filter a second order book or keep another transaction lifecycle.

`composedClient` wraps a client by composition, as the CCC connector does: an instance of `ccc.Client` but not of `ccc.ClientJsonRpc`. That's the client the interface really gets, not a convenience for tests. A test that needs real completion uses the real builders with stubbed chain responses, never builders that return their input unchanged ([why](../scripts/docs/coverage.md#where-the-line-sits)).

## Contract oracle

`src/contract_oracle.ts` models the on-chain rules apart from the SDK. A dependency-cruiser rule bars imports from the implementation it judges. Source pins and transcription notes stay at the oracle. Shared constructors may shrink fixtures, but an expected result never comes from the code it checks.

The [protocol vectors](fixtures/README.md), computed by the Rust logic of the contracts, cross-check the oracle.
