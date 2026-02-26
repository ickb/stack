---
"@ickb/core": major
"@ickb/dao": minor
"@ickb/order": major
"@ickb/utils": major
"@ickb/sdk": major
---

Adopt CCC udt.Udt as IckbUdt base class, replacing homegrown UDT infrastructure

- Rewrite `IckbUdtManager` as `IckbUdt` extending CCC's `udt.Udt` base class
- Accept code OutPoints instead of pre-built CellDep arrays
- Override `infoFrom()` to value iCKB's three cell representations (xUDT, receipt, deposit)
- Remove `udtHandler` parameter from `LogicManager` and `OwnedOwnerManager`
- Replace `UdtHandler` with plain `udtScript` in `OrderManager`
- Delete `UdtHandler`, `UdtManager`, `UdtCell`, `ErrorTransactionInsufficientCoin` from `@ickb/utils`
- Widen `DaoManager.isDeposit()` to accept `CellAny`
