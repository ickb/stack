# Wallet session

## The chain

The connector owns the selected client. The app lands on mainnet. The network list of the wallet modal switches it (the connector select-client event). The gate labels the chain from the address prefix of that client: `ckb` is mainnet, anything else testnet.

The app keeps no network tabs or saved network of its own: two switches for one choice could disagree. A separate draft chain would also undo the network choice of the user when the connector drops its signer during a switch.

The app creates one client per chain on the CCC public endpoints. On testnet, a faucet link shows under the landing page. It also shows beside CKB while there's none to convert.

## Node answers and the clock

The SDK verifies what it reads through those endpoints. It prices at the parent of the tip, bounded by the thirty minutes of the wallet policy ([node trust](../../sdk/docs/node_trust.md#the-tip-parent)). So a browser clock more than thirty minutes fast fails the account state read. Every transaction fails with it until the clock is corrected.

The quote shown before a wallet connects reads the tip directly, unverified. It's display only: every transaction is priced from the verified state read.

## Signers

The connector offers every CCC signer, with install links for wallets the browser lacks. CCC signs CKB transactions:

- from EVM wallets, through Omnilock in EVM mode or PW-Lock;
- from BTC wallets, through Omnilock in BTC mode;
- from Nostr, through the Nostr lock.

The account reads every lock the signer reports. A filter that kept only CKB signers hid MetaMask, OKX, UniSat, Xverse and Nostr, so it was removed. The gate still waits while the client of the signer is on another chain.

The automated tests and the private-key harness exercise only CKB signers. An EVM or BTC wallet is checked by hand with a real wallet.

## Address and locks

`WalletConfigGate` reads the recommended address once per signer/root configuration, with an explicit retry after failure. It ignores results that arrive after that configuration changes. It's component state, not a refetching query: tab-focus refetches used to replace script objects, which remounted the action view during signing.

The locks of the account aren't part of it: `readState` asks the signer for them on every state read, so the next refresh scans an address the wallet adds. A new recommended address still relies on the connector replacing the signer. A wallet that doesn't report it needs a reload.

## The attempt

The wallet session, not the action view, runs an attempt and holds what it shows: its phase, message, failure and frozen preview. A remount of the action view neither stops a commit nor loses its status. A page reload drops the attempt, and the next one rebuilds from committed cells. A commit can still outlive its session: a wallet that switches account replaces the signer, which ends the session, while the commit runs to its last step unseen. That's accepted as rare, since the app's own wallet button is disabled while an attempt holds the draft.
