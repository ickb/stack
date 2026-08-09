# iCKB/Node Utils

Private workspace utilities for Node-based iCKB apps.

`@ickb/node-utils` owns process and operator glue for Node-based iCKB apps such as `apps/validation`: environment parsing, public RPC client construction, signer account-lock collection, sleep loops, CKB log formatting, JSON-safe error/log serialization, elapsed-loop logging, and broadcast-timeout stop handling. `createPublicClient` requires one non-empty HTTP(S) `rpcUrl` and uses it exclusively (`fallbacks: []`); omitted or empty URLs fail instead of selecting CCC public defaults.

This package is intentionally private and should not be used by the browser interface. Submit transactions through the CCC signer, then pass the returned hash to `waitTransaction(...)` from `@ickb/sdk`.

## Licensing

Released under the [MIT License](https://github.com/ickb/stack/tree/master/LICENSE).
