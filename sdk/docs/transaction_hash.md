# The Transaction Hash

How [`commitTransaction`](signing_and_broadcast.md) names what it sent, even when the send never answers.

## The local hash

The local hash, `signed.hash()`, is the identity. The signature binds the bytes, so a node can only accept this exact transaction. No hash a node returns replaces it: checking that hash could only refuse after the node already has the transaction. A duplicate answer counts as accepted only when it names the local hash.

## No clear answer

Every other send failure leaves it unknown whether the node took the transaction. The `sent` step still carries the local hash, the failure as `cause`, and the commit watches that hash. It sends the same signed bytes again while the node doesn't know them ([confirmation](confirmation.md)).

No callback hands out the hash before the send. One did, only to let a caller record the hash while the send was in flight. The `sent` step hands it out right after the first broadcast, answered or not.

## Rejected

- Returning the hash without the error: it loses the cause the bot journals when the node keeps no reject record.
- A separate sign and broadcast.
