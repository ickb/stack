import {
  unsupportedIncident,
  writeCommandArtifacts,
  writeJsonArtifact,
  writeSummary,
} from "../../artifacts/supervisorArtifacts.ts";
import { classifyActorResult } from "../../classification/supervisorClassification.ts";
import { emptyActions } from "../../classification/supervisorClassifyUtils.ts";
import { scenarioActors } from "../actor/supervisorActorRun.ts";
import {
  BOT_DECISION_SKIPPED_EVENT,
  GIVE_CKB_FIELD,
  STOP_EXIT_CODE,
  TAKE_ICKB_FIELD,
  type Actor,
} from "../shared/supervisorConstants.ts";
import {
  chooseScenario,
  recordClassificationCoverage,
  recordScenarioAttempt,
  unsupportedClassification,
} from "../shared/supervisorCoverage.ts";
import type {
  Classification,
  CommandResult,
  CoverageLedger,
  Dependencies,
  ParsedArgs,
  PublicStateAssumption,
  SupervisorPlan,
} from "../shared/supervisorTypes.ts";
import {
  dryRunBotEvent,
  sampleCommandResult,
  sampleTransactionHash,
} from "./supervisorDryRunSamples.ts";

export async function runDryRun(
  args: Pick<ParsedArgs, "scenario" | "targetOutcomes">,
  plan: SupervisorPlan,
  ledger: CoverageLedger,
  dependencies: Dependencies,
): Promise<number> {
  const artifacts = new Array<string>();
  const classifications = new Array<Classification>();
  const choice = chooseScenario(args, ledger);
  recordScenarioAttempt(ledger, 1, choice);
  if (choice.kind === "unsupported") {
    const classification = unsupportedClassification(choice);
    classifications.push(classification);
    const incident = unsupportedIncident(plan, 1, choice, ledger, classification);
    await writeJsonArtifact(
      plan,
      "dry-run-incident.json",
      incident,
      artifacts,
      dependencies,
    );
    await writeSummary(
      plan,
      ledger,
      classifications,
      artifacts,
      [],
      undefined,
      "unsupported_scenario",
      dependencies,
    );
    return STOP_EXIT_CODE;
  }

  const samples = dryRunSamples();

  let latestPublicState: PublicStateAssumption | undefined;
  for (const sample of samples.filter((item) =>
    scenarioActors(choice.scenario).includes(item.actor),
  )) {
    const classification = classifyActorResult(sample.actor, sample.result);
    classifications.push(classification);
    recordClassificationCoverage(ledger, classification);
    latestPublicState = classification.publicState ?? latestPublicState;
    artifacts.push(
      ...(await writeCommandArtifacts(
        plan,
        1,
        `dry-run-${sample.actor}`,
        sample.result,
        dependencies,
      )),
    );
  }

  await writeSummary(
    plan,
    ledger,
    classifications,
    artifacts,
    [],
    latestPublicState,
    "dry_run",
    dependencies,
  );
  return 0;
}

function dryRunSamples(): Array<{ actor: Actor; result: CommandResult }> {
  return [
    {
      actor: "tester",
      result: sampleCommandResult("tester", dryRunTesterStdout()),
    },
    {
      actor: "bot",
      result: sampleCommandResult("bot", dryRunBotStdout()),
    },
  ];
}

function dryRunTesterStdout(): string {
  return JSON.stringify({
    startTime: "dry-run",
    actions: {
      newOrder: { [GIVE_CKB_FIELD]: "100", [TAKE_ICKB_FIELD]: "99", fee: "0.001" },
      cancelledOrders: 0,
    },
    txHash: sampleTransactionHash("11"),
    ElapsedSeconds: 1,
  });
}

function dryRunBotStdout(): string {
  return [
    JSON.stringify(
      dryRunBotEvent("bot.state.read", {
        orders: { marketCount: 3, userCount: 0, receiptCount: 1 },
        poolDeposits: { totalCount: 8, readyCount: 2 },
      }),
    ),
    JSON.stringify(
      dryRunBotEvent(BOT_DECISION_SKIPPED_EVENT, {
        reason: "no_actions",
        actions: emptyActions(),
      }),
    ),
  ].join("\n");
}
