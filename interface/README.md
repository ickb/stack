# iCKB Interface

The app behind [ickb.org](https://ickb.org): turn CKB into iCKB and back from any CCC wallet, right in the browser!!

CCC connects the wallet. [`@ickb/sdk`](../sdk/README.md) plans, completes and sends each conversion.

## Run locally

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter ./interface dev
```

For a production bundle:

```bash
pnpm --filter ./interface build
```

Both use the workspace SDK source directly: no SDK `dist/` build needed.

## Wallets and chains

The CCC connector owns the wallet and the chain. The app lands on mainnet. The network list of the wallet modal switches it. The connector offers every CCC signer: EVM, BTC and Nostr wallets sign through their CCC locks. On testnet, a faucet link shows while there's no CKB to convert.

## Converting

Each conversion shows when its funds come back. Direct deposits and withdrawals have a claim date. An order waits for a bot. Every conversion mints an order.

Every transaction also collects what's ready: fulfilled orders, receipts, matured withdrawals, orders the bot won't fill. An amount of zero only collects.

## Signing

The preview is a real transaction that follows the amount. A click freezes it: the app refreshes the state, rebuilds, then asks the wallet to sign. From the click to the last step of the commit the app stays busy, as a bank transfer does: it shows each retry and ends on the commit or a reason it failed. A reload is the only way out.

## Release

Merging a version change of `interface/package.json` to `master` deploys ickb.org ([deployment](docs/deployment.md)).

## Docs

- [Wallet session](docs/wallet_session.md): chain choice, signers, the account address, who owns the attempt.
- [Converting and collecting](docs/converting.md): dates, quotes, order price, what each transaction collects.
- [Balances](docs/balances.md): what each figure counts, Max, rounding, dust orders.
- [Signing and confirmation](docs/signing.md): preview, freeze, sign, watch.
- [Layout](docs/layout.md): what goes where on screen, the snapshots that pin the look.
- [Deployment](docs/deployment.md): build, domain, static files.
