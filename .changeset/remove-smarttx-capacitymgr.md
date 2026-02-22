---
"@ickb/utils": major
"@ickb/core": major
"@ickb/dao": major
"@ickb/order": major
"@ickb/sdk": major
---

Remove SmartTransaction and CapacityManager in favor of plain TransactionLike

- Delete `SmartTransaction` class and `CapacityManager` class from `@ickb/utils`
- Replace all `SmartTransaction` parameters with `ccc.TransactionLike` across all packages
- Inline `getHeader`/`addHeaders` helpers and remove from public API
- Consolidate 7 inline DAO output limit checks into `assertDaoOutputLimit` in CCC core
- Change `UdtHandler.completeUdt` return type from `[number, boolean]` to `[ccc.Transaction, number, boolean]`
- Replace local CCC patch with upstream PR #359
