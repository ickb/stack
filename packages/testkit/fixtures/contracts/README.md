# Contract binary fixtures

Release ELFs copied from `/var/home/user/Projects/ickb/contracts` at commit
`ae8a11fa560c157116e3f75acc316682d9cca061` (`scripts/build/release/`). The
contracts are deployed and immutable; these binaries are the offline referee
for the ckb-debugger test layer.

- Integrity: `SHA256SUMS` (verify with `sha256sum -c SHA256SUMS`).
- On-chain congruence: the validation preflight sha256-compares deployed code
  cells against these hashes (final decisions record §2 + appendix amendment 6).
- `dao.c` / system scripts must come from the deployed genesis pin
  `ckb-system-scripts@f25c5ae` — never a repo-HEAD build (the 64-output cap was
  removed upstream after deployment). `dao` was extracted 2026-08-10 from the
  mainnet and testnet genesis blocks (tx 0, output 2; byte-identical) via
  `https://mainnet.ckb.dev/rpc` and `https://testnet.ckb.dev/rpc`. Its Type ID
  type script hashes to the deployed DAO `code_hash`
  `0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e`
  (`hash_type: type`); ckb data hash
  `0x32064a14ce10d95d4b7343054cc19d73b25b16ae61a6c681011ca781a60c7923`.
