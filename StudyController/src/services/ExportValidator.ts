import { writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Schedule,
  SessionConfig,
  StudyEvent,
  TrialDefinition,
  TrialOutcome,
} from "../contracts.js";
import {
  TRIAL_SUMMARY_COLUMNS,
  type TrialSummaryRow,
} from "../csvContract.js";
import type { ExportValidationReport } from "../runtimeTypes.js";
import {
  assertSchema,
  SCHEMA_IDS,
  validateScheduleSemantics,
  validateSessionSemantics,
} from "../validation.js";

function csvCell(value: unknown): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class ExportValidator {
  public validate(
    config: SessionConfig,
    schedule: Schedule,
    events: StudyEvent[],
    completedTrialIds: readonly string[],
    requireComplete: boolean,
  ): ExportValidationReport {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      assertSchema(SCHEMA_IDS.sessionConfig, config);
      assertSchema(SCHEMA_IDS.schedule, schedule);
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : "Schema validation failed.",
      );
    }
    issues.push(...validateSessionSemantics(config));
    issues.push(...validateScheduleSemantics(schedule));

    const outcomes = new Map<string, TrialOutcome>();
    for (const [index, event] of events.entries()) {
      try {
        assertSchema(SCHEMA_IDS.event, event);
      } catch (error) {
        issues.push(
          `Event ${index + 1} is invalid: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
      if (event.sequence !== index + 1) {
        issues.push("Authoritative event sequence is not contiguous.");
        break;
      }
      if (
        event.eventType === "TRIAL_OUTCOME_RECORDED" &&
        event.trialId !== null
      ) {
        if (outcomes.has(event.trialId)) {
          issues.push(`Trial ${event.trialId} has multiple outcome records.`);
        }
        outcomes.set(
          event.trialId,
          (event.payload as { outcome: TrialOutcome }).outcome,
        );
      }
    }

    for (const trialId of completedTrialIds) {
      if (!outcomes.has(trialId)) {
        issues.push(`Completed trial ${trialId} has no outcome event.`);
      }
    }

    if (requireComplete) {
      for (const trial of schedule.trials) {
        if (!outcomes.has(trial.trialId)) {
          issues.push(`Scheduled trial ${trial.trialId} has no outcome.`);
        }
      }
    }

    for (const [trialId, outcome] of outcomes) {
      if (
        outcome !== "TECHNICAL_INVALID" &&
        outcome !== "PROTOCOL_INVALID"
      ) {
        continue;
      }
      const trial = schedule.trials.find(
        (candidate) => candidate.trialId === trialId,
      );
      if (
        trial?.kind !== "PRACTICE" &&
        !schedule.trials.some(
          ({ replacementForTrialId }) => replacementForTrialId === trialId,
        )
      ) {
        issues.push(`Invalid trial ${trialId} has no scheduled replacement.`);
      }
    }

    if (
      events.some(
        (event) =>
          event.eventType === "TRIAL_OUTCOME_RECORDED" &&
          (event.payload as { verifiedFinalAccuracy?: unknown })
            .verifiedFinalAccuracy === null,
      )
    ) {
      warnings.push(
        "Post-hoc overhead-video accuracy verification is still pending.",
      );
    }

    return {
      valid: issues.length === 0,
      checkedAtUtc: new Date().toISOString(),
      issues,
      warnings,
      counts: {
        scheduled: schedule.trials.length,
        completed: outcomes.size,
        invalid: [...outcomes.values()].filter(
          (outcome) =>
            outcome === "TECHNICAL_INVALID" ||
            outcome === "PROTOCOL_INVALID",
        ).length,
        replacements: schedule.trials.filter(
          ({ kind }) => kind === "REPLACEMENT",
        ).length,
      },
    };
  }

  public async writeTrialSummary(
    sessionDirectory: string,
    config: SessionConfig,
    schedule: Schedule,
    events: StudyEvent[],
  ): Promise<TrialSummaryRow[]> {
    const rows = schedule.trials
      .map((trial) => this.buildRow(config, trial, events))
      .filter((row): row is TrialSummaryRow => row !== null);

    const lines = [
      TRIAL_SUMMARY_COLUMNS.join(","),
      ...rows.map((row) =>
        TRIAL_SUMMARY_COLUMNS.map((column) => csvCell(row[column])).join(","),
      ),
    ];
    await writeFile(
      path.join(sessionDirectory, "trial-summary.csv"),
      `${lines.join("\n")}\n`,
      "utf8",
    );
    return rows;
  }

  private buildRow(
    config: SessionConfig,
    trial: TrialDefinition,
    events: StudyEvent[],
  ): TrialSummaryRow | null {
    const trialEvents = events.filter(({ trialId }) => trialId === trial.trialId);
    const started = trialEvents.find(
      ({ eventType }) => eventType === "TRIAL_STARTED",
    );
    const outcomeEvent = trialEvents.find(
      ({ eventType }) => eventType === "TRIAL_OUTCOME_RECORDED",
    );
    if (outcomeEvent === undefined) {
      return null;
    }
    const outcomePayload = outcomeEvent.payload as {
      outcome: TrialOutcome;
      submissionCount: number;
      liveFinalAccuracy: TrialSummaryRow["live_final_accuracy"];
      verifiedFinalAccuracy: TrialSummaryRow["verified_final_accuracy"];
      elapsedMs?: number | null;
      completedAfterTimeLimit: boolean;
      lateCorrectCompletionMs: number | null;
    };
    const submissions = trialEvents.filter(
      ({ eventType }) => eventType === "SUBMISSION_RECORDED",
    );
    const firstSubmission =
      submissions[0] === undefined
        ? null
        : (submissions[0].payload as { elapsedMs: number }).elapsedMs;
    const startedAt = started?.recordedAtUtc ?? outcomeEvent.recordedAtUtc;
    const durationMs = Math.max(
      0,
      outcomePayload.elapsedMs ??
        Date.parse(outcomeEvent.recordedAtUtc) - Date.parse(startedAt),
    );
    const invalidationAction = trialEvents.find(
      (event) =>
        event.eventType === "EXPERIMENTER_ACTION" &&
        (event.payload as { action?: string }).action === "INVALIDATE_TRIAL",
    );

    const row: TrialSummaryRow = {
      study_id: config.studyId,
      protocol_version: config.protocolVersion,
      session_id: config.sessionId,
      pair_id: config.pairId,
      trial_id: trial.trialId,
      trial_kind: trial.kind,
      condition: trial.condition,
      distractor_type: trial.distractorType,
      puzzle_id: trial.puzzleId,
      outcome: outcomePayload.outcome,
      started_at_utc: startedAt,
      ended_at_utc: outcomeEvent.recordedAtUtc,
      duration_ms: durationMs,
      submission_count: outcomePayload.submissionCount,
      first_submission_ms: firstSubmission,
      completed_after_time_limit: outcomePayload.completedAfterTimeLimit,
      late_correct_completion_ms: outcomePayload.lateCorrectCompletionMs,
      live_final_accuracy: outcomePayload.liveFinalAccuracy,
      verified_final_accuracy: outcomePayload.verifiedFinalAccuracy,
      invalidation_reason:
        invalidationAction === undefined
          ? null
          : ((invalidationAction.payload as { reason?: string }).reason ?? null),
      replacement_for_trial_id: trial.replacementForTrialId,
      include_in_analysis:
        trial.includeInAnalysis &&
        outcomePayload.outcome !== "TECHNICAL_INVALID" &&
        outcomePayload.outcome !== "PROTOCOL_INVALID" &&
        outcomePayload.outcome !== "PARTICIPANT_WITHDRAWAL" &&
        outcomePayload.outcome !== "EXPERIMENTER_ABORTED",
    };
    assertSchema(SCHEMA_IDS.trialSummaryRow, row);
    return row;
  }
}
