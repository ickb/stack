---
"@ickb/utils": major
"@ickb/order": major
"@ickb/sdk": major
---

Remove local max, min, gcd, hexFrom, isHex utility functions -- replaced by CCC equivalents

- Delete `max`, `min`, `gcd`, `hexFrom`, `isHex` from `@ickb/utils` public API
- Replace `max()` call sites with `Number(ccc.numMax())` in `@ickb/order` and `@ickb/sdk`
- Replace `gcd()` call site with `ccc.gcd()` in `@ickb/order`
- Replace `hexFrom(entity)` call sites with `entity.toHex()` in `@ickb/order` and `@ickb/sdk`
- Replace `hexFrom(bytes)` call site with `ccc.hexFrom()` in faucet app
- Update `unique()` internal implementation to use `entity.toHex()` instead of local `hexFrom()`
