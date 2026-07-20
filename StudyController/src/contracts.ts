export const SCHEMA_VERSION = "1.0.0" as const;
export const PROTOCOL_VERSION = "1.0.0" as const;
export const TRIAL_DURATION_SECONDS = 420 as const;
export const CRITICAL_FAULT_GRACE_MS = 3_000 as const;

export type Role = "DIRECTOR" | "BUILDER";
export type Condition = "NO_DR" | "SYMMETRIC_DR" | "ASYMMETRIC_DR";
export type DistractorType = "TV" | "KEYBOARD";
export type TrialKind = "PRACTICE" | "SCORED" | "REPLACEMENT";
export type RuntimeDecision = "CORRECT" | "INCORRECT";
export type Accuracy = RuntimeDecision | "UNSCORABLE";
export type CalibrationStatus = "NOT_RUN" | "PASS" | "FAIL" | "OVERRIDDEN";

export type TrialOutcome =
  | "COMPLETED"
  | "TIMEOUT"
  | "TECHNICAL_INVALID"
  | "PROTOCOL_INVALID"
  | "PARTICIPANT_WITHDRAWAL"
  | "EXPERIMENTER_ABORTED";

export type LaptopState =
  | "SERVER_READY"
  | "SESSION_SETUP"
  | "PREFLIGHT"
  | "CALIBRATION"
  | "BLOCKED"
  | "TRIAL_PREPARED"
  | "TRIAL_COMMITTED"
  | "TRIAL_ACTIVE"
  | "TRIAL_STOPPING"
  | "POST_TRIAL"
  | "CONDITION_REVIEW"
  | "SESSION_COMPLETE"
  | "RECOVERY_REQUIRED";

export type QuestState =
  | "BOOTING"
  | "PERMISSION_REQUIRED"
  | "CONNECTING"
  | "SYNCHRONIZING"
  | "IDLE"
  | "CALIBRATING"
  | "READY"
  | "TRIAL_PREPARED"
  | "TRIAL_COMMITTED"
  | "TRIAL_ACTIVE"
  | "STOPPING"
  | "FAULTED"
  | "RECOVERING";

export type MessageType =
  | "PREPARE_TRIAL"
  | "READY"
  | "COMMIT_START"
  | "STARTED"
  | "SUBMIT"
  | "STOP_TRIAL"
  | "STOPPED"
  | "FAULT"
  | "HEARTBEAT"
  | "STATE_SNAPSHOT";

export interface TrialDefinition {
  trialId: string;
  kind: TrialKind;
  order: number;
  blockIndex: number | null;
  condition: Condition;
  distractorType: DistractorType;
  puzzleId: string;
  replacementForTrialId: string | null;
  includeInAnalysis: boolean;
}

export interface Schedule {
  schemaVersion: typeof SCHEMA_VERSION;
  scheduleId: string;
  scheduleVersion: number;
  generatedAtUtc: string;
  randomizationSeed: string;
  trials: TrialDefinition[];
}

export interface DeviceAssignment {
  deviceId: string;
  role: Role;
  accessTokenRef: string;
}

export interface SessionConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  protocolVersion: string;
  studyId: string;
  sessionId: string;
  pairId: string;
  createdAtUtc: string;
  trialDurationSeconds: typeof TRIAL_DURATION_SECONDS;
  asymmetricRecipient: Role;
  deviceAssignments: DeviceAssignment[];
  calibrationPolicy: {
    manualOverrideAllowed: true;
    thresholdProfile: string | null;
  };
  schedulePath: string;
  scheduleSha256: string;
}

export interface MessageEnvelope<TPayload = Record<string, unknown>> {
  protocolVersion: string;
  sessionId: string;
  trialId: string | null;
  commandId: string;
  stateVersion: number;
  sender: string;
  target: string;
  timestampUtc: string;
  timestampMonotonicMs: number;
  type: MessageType;
  payload: TPayload;
}

export interface StudyEvent<TPayload = Record<string, unknown>> {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  sessionId: string;
  trialId: string | null;
  stateVersion: number;
  recordedAtUtc: string;
  recordedAtMonotonicMs: number;
  source: string;
  eventType: string;
  correctsEventId: string | null;
  payload: TPayload;
}
