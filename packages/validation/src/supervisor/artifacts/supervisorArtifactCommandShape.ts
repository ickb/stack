import process from "node:process";
import type { CommandResult, SupervisorPlan } from "../runtime/shared/supervisorTypes.ts";

export function commandShape(
  plan: SupervisorPlan,
  result: CommandResult,
): Record<string, unknown> {
  return {
    command: result.command === process.execPath ? "node" : result.command,
    args: result.args.map((arg) => {
      if (arg === plan.botConfigPath) {
        return "<bot-config-path>";
      }
      if (arg === plan.testerConfigPath) {
        return "<tester-config-path>";
      }
      return arg;
    }),
    timeoutMs: result.timeoutMs,
  };
}
