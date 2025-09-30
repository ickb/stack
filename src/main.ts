import { ccc } from "@ckb-ccc/core";

export function hello(): string {
  return `Hello ${Object.values(ccc.KnownScript).join(", ")}!`;
}
