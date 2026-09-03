import process from "node:process";
import { assertNoSymlinkedConfigPath } from "../../args/supervisorPaths.ts";
import { liveActorEnv } from "../../classification/supervisorClassifyUtils.ts";
import { testerScenarioFor } from "../../preflight/supervisorPreflightState.ts";
import { runCommand } from "../command/supervisorCommandRun.ts";
import { TESTER_OWNED_TX_HASH_FLAG } from "../shared/supervisorConstants.ts";
import type {
  CommandResult,
  ScenarioStep,
  SupervisorDependencies,
  SupervisorPlan,
} from "../shared/supervisorTypes.ts";

export async function runActor(
  ...[step, plan, timeoutMs, ownedTxHash, dependencies]: [
    step: ScenarioStep,
    plan: SupervisorPlan,
    timeoutMs: number,
    ownedTxHash: string | undefined,
    dependencies: SupervisorDependencies,
  ]
): Promise<CommandResult> {
  const actor = step.actor;
  const configPath = actor === "bot" ? plan.botConfigPath : plan.testerConfigPath;
  await assertNoSymlinkedConfigPath(
    plan.rootDir,
    configPath,
    `${actor} config path`,
    dependencies,
  );
  const entrypoint = dependencies.actorEntrypoints[actor];
  const configEnvName = actor === "bot" ? "BOT_CONFIG_FILE" : "TESTER_CONFIG_FILE";
  return runCommand(
    {
      actor,
      command: process.execPath,
      args: [
        entrypoint,
        ...(ownedTxHash === undefined ? [] : [TESTER_OWNED_TX_HASH_FLAG, ownedTxHash]),
      ],
      cwd: plan.rootDir,
      env: liveActorEnv({
        [configEnvName]: configPath,
        INIT_CWD: plan.rootDir,
        ...(actor === "tester" ? testerEnv(plan, step) : {}),
      }),
      timeoutMs,
    },
    dependencies,
  );
}

function testerEnv(plan: SupervisorPlan, step: ScenarioStep): Record<string, string> {
  return {
    TESTER_SCENARIO: testerScenarioFor(plan, step),
    ...(plan.testerFee === undefined ? {} : { TESTER_FEE: plan.testerFee }),
    ...(plan.testerFeeBase === undefined ? {} : { TESTER_FEE_BASE: plan.testerFeeBase }),
  };
}
