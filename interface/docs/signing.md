# Signing and confirmation

## Preview

React Query owns chain reads and transaction previews. A preview completes a real transaction, so it follows the amount only after 300 ms without another edit.

Clicking the action freezes the draft, refreshes the wallet state, then rebuilds before asking for a signature. Withdrawal timing uses [`WALLET_LOCK_UP`](../../sdk/src/dao.ts), whose wider margins allow for a wallet popup left open. The SDK checks a fresh epoch deadline after signing.

## After the send

From the click to the last step of the [commit](../../sdk/src/send/commit_transaction.ts), the app is busy, as a bank transfer is: the draft stays frozen and the action reads "confirming...". There's no cancel and no timeout; a page reload is the only way out. Each step:

- **sent or pending:** the message shows the hash and that it waits for confirmation. A step with a cause adds it as a retry, such as a broadcast that got no clear answer or a status read that failed.
- **committed:** the app invalidates the account query, then clears the request.
- **declined signature:** a plain "Not signed" note shows the wallet message, then releases the preview. Nothing was sent, so nothing resets.
- **expired:** the withdrawal timing changed while the wallet was open. Nothing was sent; the preview is released to rebuild.
- **abandoned:** the withdrawal deadline passed before the network took the transaction, so it's no longer sent. An earlier copy may still land.
- **rejected:** the app shows the cause and the hash, then releases the unchanged form for editing.

## Failure messages

The failure of the last attempt stays visible until another attempt starts or the draft changes. Tying it to the identity of the sampled state made a rejection disappear at the next poll. The status uses one reserved line, not a second failure row that would move the form.

## Unverified

Real Rei wallet behavior when completion tries several candidate prefixes remains unverified: the automated completion tests don't establish whether that wallet prompts again.
