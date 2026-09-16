import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  SCHEMA_VERSION,
  type CounterbalanceAllocation,
  type CounterbalancePlan,
  type Schedule,
  type TrialDefinition,
} from "../contracts.js";
import type { LoadedAllocation } from "../runtimeTypes.js";
import {
  assertSchema,
  SCHEMA_IDS,
  validateCounterbalancePlanSemantics,
  validateScheduleSemantics,
} from "../validation.js";

export class CounterbalanceScheduler {
  private plan: CounterbalancePlan | null = null;

  public constructor(public readonly planPath: string) {}

  public async load(): Promise<CounterbalancePlan> {
    const plan = JSON.parse(await readFile(this.planPath, "utf8")) as unknown;
    assertSchema(SCHEMA_IDS.counterbalancePlan, plan);
    const typedPlan = plan as CounterbalancePlan;
    const issues = validateCounterbalancePlanSemantics(typedPlan);
    if (issues.length > 0) {
      throw new Error(
        `Counterbalance plan failed semantic validation:\n${issues.join("\n")}`,
      );
    }
    this.plan = typedPlan;
    return typedPlan;
  }

  public async selectForPair(pairId: string): Promise<LoadedAllocation> {
    const plan = this.plan ?? (await this.load());
    const allocation = plan.allocations.find(
      (candidate) => candidate.pairId === pairId,
    );
    if (allocation === undefined) {
      throw new Error(`No counterbalance allocation exists for ${pairId}.`);
    }
    return {
      allocation: structuredClone(allocation),
      sourcePlanPath: this.planPath,
    };
  }

  public createReplacement(
    allocation: CounterbalanceAllocation,
    currentSchedule: Schedule,
    invalidTrialId: string,
  ): TrialDefinition {
    const invalidTrial = currentSchedule.trials.find(
      ({ trialId }) => trialId === invalidTrialId,
    );
    if (invalidTrial === undefined || invalidTrial.kind === "PRACTICE") {
      throw new Error(
        "Only an existing scored or replacement trial can receive a reserve replacement.",
      );
    }

    const usedPuzzles = new Set(
      currentSchedule.trials.map(({ puzzleId }) => puzzleId),
    );
    const puzzleId = allocation.reservePuzzleIds.find(
      (candidate) => !usedPuzzles.has(candidate),
    );
    if (puzzleId === undefined) {
      throw new Error("No unused reserve puzzle remains for this allocation.");
    }

    const replacementCount = currentSchedule.trials.filter(
      ({ kind }) => kind === "REPLACEMENT",
    ).length;
    return {
      trialId: `REPLACEMENT-${String(replacementCount + 1).padStart(2, "0")}`,
      kind: "REPLACEMENT",
      order:
        Math.max(...currentSchedule.trials.map(({ order }) => order), 0) + 1,
      blockIndex: invalidTrial.blockIndex,
      condition: invalidTrial.condition,
      distractorType: invalidTrial.distractorType,
      puzzleId,
      replacementForTrialId: invalidTrial.trialId,
      includeInAnalysis: true,
    };
  }

  public appendReplacement(
    schedule: Schedule,
    replacement: TrialDefinition,
  ): Schedule {
    const updated: Schedule = {
      ...schedule,
      schemaVersion: SCHEMA_VERSION,
      scheduleVersion: schedule.scheduleVersion + 1,
      generatedAtUtc: new Date().toISOString(),
      trials: [...schedule.trials, replacement],
    };
    assertSchema(SCHEMA_IDS.schedule, updated);
    const issues = validateScheduleSemantics(updated);
    if (issues.length > 0) {
      throw new Error(`Replacement schedule is invalid:\n${issues.join("\n")}`);
    }
    return updated;
  }
}

export function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");
}

