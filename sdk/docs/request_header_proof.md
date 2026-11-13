# Request Header Proof

Why the send proves which block committed each withdrawal request and what that costs.

## The swap

A phase-2 DAO input is valued at its deposit header and its request header, both named in the transaction deps. The deps bind the request header to some block the transaction names, but not to the block that committed that input.

So in a withdrawal of several requests, a node could swap which named request header values which input. That pays the rate drift between the two blocks, times the capacity imbalance, to the miner.

## The proof

The send asks the node for `get_transaction_proof` of each request transaction, against the request header it valued. It refuses unless the Merkle path from the transaction hash reaches the transactions root of that header, which the header hash binds.

That's one call of a few hundred bytes per request transaction per send, through the client JSON-RPC requestor. So such a send needs a JSON-RPC client.

The proven header is the real request block. So the `dao.c` rule that it must come after the deposit is left to the chain: a copy of that rule in the send, added before the proof, was dropped.

A proven pair never changes, but caching it saved nothing: a request is spent once. It's proven again only when a failed send is rebuilt.

## Rejected

- **Reading the whole block:** proves the same with up to hundreds of kilobytes.
- **A second node:** replaces proof with trust.
- **Valuing every request at the highest-numbered dep:** closes the swap without a call, but splits withdrawals by block.
- **An on-chain script checking a digest of the inputs and their headers:** its carrier cell is left behind by the last transaction of a flow.
- **Accepting the swap:** the earlier choice.

## What needs no proof

Deposits, receipts and their headers: iCKB Logic settles them with strict equality, so a wrong header gets the transaction refused. A deposit header is matched by the number in the verified cell data.
