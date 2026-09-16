import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { hasExactTrialSummaryHeader } from "../src/csvContract.js";
import { createDeterministicCalibrationReport } from "../src/simulation/simulatedCalibrationReport.js";
import {
  APRILTAG_DETECTION_SIZE_METERS,
  CALIBRATION_THRESHOLD_PROFILE,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type CounterbalancePlan,
  type Schedule,
  type SessionConfig,
} from "../src/contracts.js";
import {
  SCHEMA_IDS,
  validateCounterbalancePlanSemantics,
  validateScheduleSemantics,
  validateSchema,
  validateSessionSemantics,
} from "../src/validation.js";

const sessionId = "5d81618b-b713-4d67-8e81-b9096671b8b7";

function makeSchedule(): Schedule {
  return {
    schemaVersion: SCHEMA_VERSION,
    scheduleId: "CONTRACT_TEST_ONLY",
    scheduleVersion: 1,
    generatedAtUtc: "2026-07-20T00:00:00.000Z",
    randomizationSeed: "contract-test",
    trials: [
      {
        trialId: "PRACTICE-01",
        kind: "PRACTICE",
        order: 1,
        blockIndex: null,
        condition: "NO_DR",
        distractorType: "KEYBOARD",
        puzzleId: "PRACTICE_TEST",
        replacementForTrialId: null,
        includeInAnalysis: false,
      },
      ...(["NO_DR", "SYMMETRIC_DR", "ASYMMETRIC_DR"] as const).flatMap(
        (condition, conditionIndex) =>
          (["TV", "KEYBOARD"] as const).map((distractorType, distractorIndex) => {
            const index = conditionIndex * 2 + distractorIndex + 1;
            return {
              trialId: `SCORED-0${index}`,
              kind: "SCORED" as const,
              order: index + 1,
              blockIndex: conditionIndex + 1,
              condition,
              distractorType,
              puzzleId: `PUZZLE_TEST_${index}`,
              replacementForTrialId: null,
              includeInAnalysis: true,
            };
          }),
      ),
    ],
  };
}

describe("JSON schemas", () => {
  it("validates a session configuration without storing an access token", () => {
    const config: SessionConfig = {
      schemaVersion: SCHEMA_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      studyId: "CDR",
      sessionId,
      pairId: "PAIR-012",
      createdAtUtc: "2026-07-20T00:00:00.000Z",
      approvedQuestBuildId: "cdr-phase4-dev-1",
      trialDurationSeconds: 420,
      asymmetricRecipient: "DIRECTOR",
      deviceAssignments: [
        {
          deviceId: "QUEST_A",
          participantId: "P012-A",
          role: "DIRECTOR",
          accessTokenRef: "secrets/quest-a",
        },
        {
          deviceId: "QUEST_B",
          participantId: "P012-B",
          role: "BUILDER",
          accessTokenRef: "secrets/quest-b",
        },
      ],
      calibrationPolicy: {
        manualOverrideAllowed: true,
        thresholdProfile: null,
      },
      schedulePath: "schedule.json",
      scheduleSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };

    expect(validateSchema(SCHEMA_IDS.sessionConfig, config).valid).toBe(true);
    expect(validateSessionSemantics(config)).toEqual([]);
  });

  it("validates the study schedule structure and design balance", () => {
    const schedule = makeSchedule();
    expect(validateSchema(SCHEMA_IDS.schedule, schedule).valid).toBe(true);
    expect(validateScheduleSemantics(schedule)).toEqual([]);
  });

  it("rejects a malformed protocol message", () => {
    const malformed = {
      protocolVersion: PROTOCOL_VERSION,
      type: "SUBMIT",
      payload: {
        attemptNumber: 0,
        verbalSubmissionObserved: true,
        runtimeDecision: "CORRECT",
      },
    };

    expect(validateSchema(SCHEMA_IDS.message, malformed).valid).toBe(false);
  });

  it("requires a reason whenever calibration is manually overridden", () => {
    const readyMessage = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      trialId: "SCORED-01",
      commandId: "37e245a5-1171-4f8f-b4e7-13c99b8ddad5",
      stateVersion: 6,
      sender: "QUEST_A",
      target: "SERVER",
      timestampUtc: "2026-07-20T00:00:00.000Z",
      timestampMonotonicMs: 1000,
      type: "READY",
      payload: {
        readiness: "READY",
        calibrationStatus: "OVERRIDDEN",
        calibrationOverrideReason: null as string | null,
        drStateMatches: true,
        drState: {
          requestedAction: "PREPARE",
          target: "TV",
          profileVersion: "PHASE6_TEST_V1",
          requestedEnabled: true,
          actualState: "PREPARED",
          prepared: true,
          maskVisible: false,
          debugBoundsVisible: false,
          geometryActive: false,
          calibrationAttemptId: "b3fa288b-8514-4ad1-a73f-f0361ec50463",
          calibrationStatus: "OVERRIDDEN",
          drStateMatches: true,
          measuredFps: null,
          performanceTargetFps: 72,
          performanceGateEvaluated: false,
          performanceGatePass: null,
          reason: null,
        },
        appVersion: "0.1.0",
        deviceStatus: "READY",
        reasons: [],
      },
    };

    expect(validateSchema(SCHEMA_IDS.message, readyMessage).valid).toBe(false);
    readyMessage.payload.calibrationOverrideReason =
      "Pilot operator accepted the recorded deviation.";
    expect(validateSchema(SCHEMA_IDS.message, readyMessage).valid).toBe(true);
  });

  it("validates the strict Phase 5 calibration command and derived report", () => {
    const attemptId = "b3fa288b-8514-4ad1-a73f-f0361ec50463";
    const common = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      trialId: "SCORED-01",
      commandId: "37e245a5-1171-4f8f-b4e7-13c99b8ddad5",
      stateVersion: 6,
      timestampUtc: "2026-07-20T00:00:00.000Z",
      timestampMonotonicMs: 1000,
    };
    const command = {
      ...common,
      sender: "SERVER",
      target: "QUEST_A",
      type: "BEGIN_CALIBRATION",
      payload: {
        attemptId,
        durationMs: 6_000,
        tagFamily: "tagStandard41h12",
        tagSizeMeters: APRILTAG_DETECTION_SIZE_METERS,
        requiredTagIds: [1, 2, 3, 4, 5, 6],
        minimumVisibleTvTags: 3,
        thresholdProfile: CALIBRATION_THRESHOLD_PROFILE,
      },
    };
    const report = {
      ...common,
      sender: "QUEST_A",
      target: "SERVER",
      type: "CALIBRATION_REPORT",
      payload: createDeterministicCalibrationReport(attemptId, true),
    };

    expect(validateSchema(SCHEMA_IDS.message, command).valid).toBe(true);
    expect(validateSchema(SCHEMA_IDS.message, report).valid).toBe(true);
    expect(JSON.stringify(report)).not.toContain("frameData");
    expect(report.payload.rawFramesPersisted).toBe(false);
  });

  it("rejects an invalid analytical event payload", () => {
    const invalidSubmission = {
      schemaVersion: SCHEMA_VERSION,
      eventId: "0a3ce66e-fad7-49c7-a72a-4423047f8c92",
      sequence: 1,
      sessionId,
      trialId: "SCORED-01",
      stateVersion: 7,
      recordedAtUtc: "2026-07-20T00:00:00.000Z",
      recordedAtMonotonicMs: 1000,
      source: "DASHBOARD",
      eventType: "SUBMISSION_RECORDED",
      correctsEventId: null,
      payload: {
        attemptNumber: 0,
        elapsedMs: 1000,
        runtimeDecision: "INCORRECT",
      },
    };

    expect(validateSchema(SCHEMA_IDS.event, invalidSubmission).valid).toBe(false);
  });

  it("validates every delivered example and the schedule checksum", () => {
    const readJson = (relativePath: string): unknown =>
      JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

    expect(
      validateSchema(
        SCHEMA_IDS.counterbalancePlan,
        readJson("../examples/counterbalance-plan.example.json"),
      ).valid,
    ).toBe(true);
    expect(
      validateCounterbalancePlanSemantics(
        readJson(
          "../examples/counterbalance-plan.example.json",
        ) as CounterbalancePlan,
      ),
    ).toEqual([]);
    expect(
      validateSchema(
        SCHEMA_IDS.message,
        readJson("../examples/submit-message.example.json"),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        SCHEMA_IDS.snapshot,
        readJson("../examples/state-snapshot.example.json"),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        SCHEMA_IDS.trialSummaryRow,
        readJson("../examples/trial-summary-row.example.json"),
      ).valid,
    ).toBe(true);

    const scheduleBytes = readFileSync(
      new URL("../examples/schedule.example.json", import.meta.url),
    );
    const exampleSchedule = JSON.parse(scheduleBytes.toString()) as Schedule;
    const exampleConfig = readJson(
      "../examples/session-config.example.json",
    ) as SessionConfig;
    expect(validateSchema(SCHEMA_IDS.schedule, exampleSchedule).valid).toBe(true);
    expect(validateScheduleSemantics(exampleSchedule)).toEqual([]);
    expect(
      validateSchema(SCHEMA_IDS.sessionConfig, exampleConfig).valid,
    ).toBe(true);
    expect(validateSessionSemantics(exampleConfig)).toEqual([]);
    expect(createHash("sha256").update(scheduleBytes).digest("hex")).toBe(
      exampleConfig.scheduleSha256,
    );

    const eventLines = readFileSync(
      new URL("../examples/authoritative-events.example.jsonl", import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n");
    for (const line of eventLines) {
      expect(validateSchema(SCHEMA_IDS.event, JSON.parse(line)).valid).toBe(true);
    }

    const [header] = readFileSync(
      new URL("../examples/trial-summary.example.csv", import.meta.url),
      "utf8",
    ).split("\n");
    expect(hasExactTrialSummaryHeader(header!.split(","))).toBe(true);
  });
});
