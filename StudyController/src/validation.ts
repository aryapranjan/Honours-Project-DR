import { createRequire } from "node:module";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

import commonSchema from "../schemas/common.schema.json" with { type: "json" };
import eventSchema from "../schemas/event.schema.json" with { type: "json" };
import messageSchema from "../schemas/message.schema.json" with { type: "json" };
import scheduleSchema from "../schemas/schedule.schema.json" with { type: "json" };
import sessionConfigSchema from "../schemas/session-config.schema.json" with {
  type: "json",
};
import snapshotSchema from "../schemas/snapshot.schema.json" with { type: "json" };
import trialSummaryRowSchema from "../schemas/trial-summary-row.schema.json" with {
  type: "json",
};
import type {
  Condition,
  DistractorType,
  Schedule,
  SessionConfig,
} from "./contracts.js";

export const SCHEMA_IDS = {
  event: eventSchema.$id,
  message: messageSchema.$id,
  schedule: scheduleSchema.$id,
  sessionConfig: sessionConfigSchema.$id,
  snapshot: snapshotSchema.$id,
  trialSummaryRow: trialSummaryRowSchema.$id,
} as const;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;
addFormats(ajv);

for (const schema of [
  commonSchema,
  eventSchema,
  messageSchema,
  scheduleSchema,
  sessionConfigSchema,
  snapshotSchema,
  trialSummaryRowSchema,
]) {
  ajv.addSchema(schema);
}

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null | undefined;
}

export function validateSchema(schemaId: string, value: unknown): ValidationResult {
  const validator = ajv.getSchema(schemaId);
  if (validator === undefined) {
    throw new Error(`Unknown schema: ${schemaId}`);
  }

  const valid = validator(value);
  if (typeof valid !== "boolean") {
    throw new Error(`Asynchronous schemas are not supported: ${schemaId}`);
  }
  return { valid, errors: validator.errors };
}

export function assertSchema(schemaId: string, value: unknown): void {
  const result = validateSchema(schemaId, value);
  if (!result.valid) {
    throw new Error(ajv.errorsText(result.errors, { separator: "\n" }));
  }
}

export function validateSessionSemantics(config: SessionConfig): string[] {
  const issues: string[] = [];
  const devices = new Set(config.deviceAssignments.map(({ deviceId }) => deviceId));
  const roles = new Set(config.deviceAssignments.map(({ role }) => role));

  if (devices.size !== 2) {
    issues.push("Session must assign two distinct Quest device IDs.");
  }

  if (roles.size !== 2 || !roles.has("DIRECTOR") || !roles.has("BUILDER")) {
    issues.push("Session must assign exactly one Director and one Builder.");
  }

  return issues;
}

export function validateScheduleSemantics(schedule: Schedule): string[] {
  const issues: string[] = [];
  const practice = schedule.trials.filter(({ kind }) => kind === "PRACTICE");
  const scored = schedule.trials.filter(({ kind }) => kind === "SCORED");
  const trialIds = new Set(schedule.trials.map(({ trialId }) => trialId));
  const orders = new Set(schedule.trials.map(({ order }) => order));

  if (practice.length !== 1) {
    issues.push("Schedule must contain exactly one practice trial.");
  }

  if (scored.length !== 6) {
    issues.push("Schedule must contain exactly six scored trials.");
  }

  if (trialIds.size !== schedule.trials.length) {
    issues.push("Trial IDs must be unique.");
  }

  if (orders.size !== schedule.trials.length) {
    issues.push("Trial order values must be unique.");
  }

  const sortedOrders = [...orders].sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => order !== index + 1)) {
    issues.push("Trial order values must be contiguous and begin at one.");
  }

  const practiceOrder = practice[0]?.order;
  if (
    practiceOrder !== undefined &&
    scored.some(({ order }) => order <= practiceOrder)
  ) {
    issues.push("The practice trial must precede every scored trial.");
  }

  const conditions: Condition[] = ["NO_DR", "SYMMETRIC_DR", "ASYMMETRIC_DR"];
  const distractors: DistractorType[] = ["TV", "KEYBOARD"];

  for (const condition of conditions) {
    const conditionTrials = scored.filter((trial) => trial.condition === condition);
    for (const distractor of distractors) {
      const count = conditionTrials.filter(
        (trial) => trial.distractorType === distractor,
      ).length;
      if (count !== 1) {
        issues.push(
          `${condition} must contain exactly one ${distractor} scored trial.`,
        );
      }
    }
  }

  for (const replacement of schedule.trials.filter(
    ({ kind }) => kind === "REPLACEMENT",
  )) {
    const replacedTrial = schedule.trials.find(
      ({ trialId }) => trialId === replacement.replacementForTrialId,
    );
    if (replacedTrial?.kind !== "SCORED") {
      issues.push(
        `${replacement.trialId} must reference an existing scored trial.`,
      );
    }
  }

  return issues;
}
