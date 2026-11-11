# Signing and confirmation

## Preview

React Query owns chain reads and transaction previews. A preview completes a real transaction, so it follows the amount only after 300 ms without another edit.

Clicking the action freezes the draft, refreshes the wallet state, then rebuilds before asking for a signature. Withdrawal timing uses [`WALLET_LOCK_UP`](../../sdk/src/dao.ts), whose wider margins allow for a wallet popup left open. The SDK checks a fresh epoch deadline after signing.

## After the send

After broadcast, the app watches the local hash of the transaction for one 60-second window at depth zero. A lost send response enters the same wait, since the node may already hold the transaction. Each outcome:

- **declined signature:** a plain "Not signed" note shows the wallet message then releases the preview. Nothing was sent, so nothing resets.
- **timeout:** the frozen preview and hash stay for a confirmation retry in the same session, without another signature or broadcast.
- **rejection:** the app shows its hash then releases the unchanged form for editing.
- **confirmation:** the app invalidates the account query then clears the request and the pending hash.

The [SDK confirmation contract](../../sdk/docs/confirmation.md) owns status reads and timeout behavior.

## Failure messages

The failure of the last attempt stays visible until another attempt starts or the draft changes. Tying it to the identity of the sampled state made a rejection disappear at the next poll. The status uses one reserved line, not a second failure row that would move the form.

## Unverified

Real Rei wallet behavior when completion tries several candidate prefixes remains unverified: the automated completion tests don't establish whether that wallet prompts again.
