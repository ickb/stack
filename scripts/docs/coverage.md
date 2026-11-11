# Coverage

[`vitest.config.mts`](../../vitest.config.mts) requires 100% statements, branches, functions and lines on `sdk/src` and `sdk/node/src`. Nothing under `sdk/` can opt a branch out: ESLint rejects a coverage-ignore comment.

The bot and generator entrypoints are left out of imported-module coverage. Their tests spawn them, which V8 coverage can't see. The sampler entrypoint is imported with its sampling mocked, so it's covered.

## Where the line sits

The thresholds cover the transaction and actor paths. On test doubles and presentation glue they would demand tests of the apparatus whenever its shape changes. So the test kit and the interface have tests, without a percentage target.

The bot fixture uses the real SDK builders, so their constraints stay visible. A no-op builder once hid a prefix walk reusing a transaction that earlier candidates had mutated. The [test kit](../../testkit/README.md) holds the shared doubles and the contract oracle.
