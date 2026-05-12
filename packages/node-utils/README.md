# iCKB/Node Utils

Private workspace utilities for Node-based iCKB apps.

`@ickb/node-utils` owns process and operator glue for Node-based iCKB apps such as `apps/tester`: environment parsing, public RPC client construction, signer account-lock collection, sleep loops, CKB log formatting, JSON-safe error/log serialization, elapsed-loop logging, and broadcast-timeout stop handling.

This package is intentionally private and should not be used by the browser interface. Cross-runtime transaction lifecycle helpers, such as `sendAndWaitForCommit(...)`, stay in `@ickb/sdk`.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/tree/master/LICENSE).
