import type { ccc } from "@ckb-ccc/ccc";

/**
 * The one transaction the wallet session may have in flight: being submitted, or sent and
 * awaiting confirmation. Current-session only: a reload starts with nothing pending, and
 * the next action rebuilds from committed cells.
 */
export type PendingTransactionState =
  | Readonly<{ status: "submitting"; result: Promise<ccc.Hex> }>
  | Readonly<{ status: "pending"; txHash: ccc.Hex }>;

/**
 * Holder of the pending record, owned by the component that owns the wallet session
 * (decisions amendment 46(i)): the async transaction flow reads and writes `current`
 * synchronously, and every write is mirrored into that component's state through `onChange`.
 */
export interface PendingTransactionStore {
  current: PendingTransactionState | undefined;
  readonly onChange: (state: PendingTransactionState | undefined) => void;
}

export function createPendingTransactionStore(
  onChange: (state: PendingTransactionState | undefined) => void,
): PendingTransactionStore {
  return { current: undefined, onChange };
}

// eslint-disable-next-line @typescript-eslint/promise-function-async -- Every non-owner must receive the exact shared submission promise.
export function submitPendingTransaction(
  store: PendingTransactionStore,
  submit: (recordTxHash: (txHash: ccc.Hex) => void) => Promise<ccc.Hex>,
): Promise<ccc.Hex> {
  const current = store.current;
  if (current?.status === "pending") {
    return Promise.resolve(current.txHash);
  }
  if (current?.status === "submitting") {
    return current.result;
  }
  const completion = Promise.withResolvers<ccc.Hex>();
  // The promise is the submission's identity: a write lands only while it still owns the record.
  const result = completion.promise;
  write(store, { status: "submitting", result });
  const storeHash = (txHash: ccc.Hex): void => {
    if (store.current?.status === "submitting" && store.current.result === result) {
      write(store, { status: "pending", txHash });
    }
  };

  void Promise.resolve()
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Adopt synchronous throws without wrapping the submission result again.
    .then(() => submit(storeHash))
    .then(
      (txHash) => {
        storeHash(txHash);
        completion.resolve(txHash);
        return null;
      },
      (error: unknown) => {
        if (store.current?.status === "submitting" && store.current.result === result) {
          write(store, undefined);
        }
        completion.reject(error);
        return null;
      },
    );
  return result;
}

export function clearPendingTransaction(store: PendingTransactionStore): void {
  write(store, undefined);
}

function write(
  store: PendingTransactionStore,
  next: PendingTransactionState | undefined,
): void {
  const holder = store;
  holder.current = next;
  store.onChange(next);
}
