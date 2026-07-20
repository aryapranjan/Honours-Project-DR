import type {
  Accuracy,
  Condition,
  DistractorType,
  TrialKind,
  TrialOutcome,
} from "./contracts.js";

export const TRIAL_SUMMARY_COLUMNS = [
  "study_id",
  "protocol_version",
  "session_id",
  "pair_id",
  "trial_id",
  "trial_kind",
  "condition",
  "distractor_type",
  "puzzle_id",
  "outcome",
  "started_at_utc",
  "ended_at_utc",
  "duration_ms",
  "submission_count",
  "first_submission_ms",
  "live_final_accuracy",
  "verified_final_accuracy",
  "invalidation_reason",
  "replacement_for_trial_id",
  "include_in_analysis",
] as const;

export interface TrialSummaryRow {
  study_id: string;
  protocol_version: string;
  session_id: string;
  pair_id: string;
  trial_id: string;
  trial_kind: TrialKind;
  condition: Condition;
  distractor_type: DistractorType;
  puzzle_id: string;
  outcome: TrialOutcome;
  started_at_utc: string;
  ended_at_utc: string;
  duration_ms: number;
  submission_count: number;
  first_submission_ms: number | null;
  live_final_accuracy: Accuracy | null;
  verified_final_accuracy: Accuracy | null;
  invalidation_reason: string | null;
  replacement_for_trial_id: string | null;
  include_in_analysis: boolean;
}

export function hasExactTrialSummaryHeader(columns: readonly string[]): boolean {
  return (
    columns.length === TRIAL_SUMMARY_COLUMNS.length &&
    columns.every((column, index) => column === TRIAL_SUMMARY_COLUMNS[index])
  );
}
