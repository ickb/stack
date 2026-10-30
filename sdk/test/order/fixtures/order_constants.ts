import type { ccc } from "@ckb-ccc/core";

export type GetTransactionHash = Parameters<ccc.Client["getTransaction"]>[0];
export type GetTransactionReturn = ReturnType<ccc.Client["getTransaction"]>;
