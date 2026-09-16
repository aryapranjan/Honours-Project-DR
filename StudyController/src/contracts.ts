export const SCHEMA_VERSION = "1.4.0" as const;
export const PROTOCOL_VERSION = "1.3.0" as const;
export const DEFAULT_APPROVED_QUEST_BUILD_ID = "cdr-phase6-dev-1" as const;
export const DR_PROFILE_VERSION = "PHASE6_TEST_V1" as const;
export const APRILTAG_DETECTION_SIZE_METERS = 0.0567 as const;
export const CALIBRATION_THRESHOLD_PROFILE = "PROVISIONAL_PHASE5_V2" as const;
export const TRIAL_TIME_LIMIT_SECONDS = 420 as const;
export const CRITICAL_FAULT_GRACE_MS = 3_000 as const;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1_000;

export type Role = "DIRECTOR" | "BUILDER";
export type ParticipantSlot = "A" | "B";
export type Condition = "NO_DR" | "SYMMETRIC_DR" | "ASYMMETRIC_DR";
export type DistractorType = "TV" | "KEYBOARD";
export type TrialKind = "PRACTICE" | "SCORED" | "REPLACEMENT";
export type RuntimeDecision = "CORRECT" | "INCORRECT";
export type Accuracy = RuntimeDecision | "UNSCORABLE";
export type CalibrationStatus = "NOT_RUN" | "PASS" | "FAIL" | "OVERRIDDEN";
export type QuestDeviceId = "QUEST_A" | "QUEST_B";
export type DrPreviewAction =
  | "PREPARE"
  | "SHOW"
  | "HIDE"
  | "REVEAL"
  | "SET_DEBUG_BOUNDS"
  | "REPORT";

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
  | "BEGIN_CALIBRATION"
  | "CALIBRATION_REPORT"
  | "PREPARE_TRIAL"
  | "READY"
  | "COMMIT_START"
  | "STARTED"
  | "SUBMIT"
  | "STOP_TRIAL"
  | "STOPPED"
  | "FAULT"
  | "HEARTBEAT"
  | "HEARTBEAT_ACK"
  | "STATE_SNAPSHOT"
  | "STATE_SNAPSHOT_APPLIED"
  | "CONTINUE_AFTER_RECOVERY"
  | "CONTINUED"
  | "REQUEST_LOCAL_LOG_STATUS"
  | "LOCAL_LOG_STATUS"
  | "CLEANUP_LOCAL_LOG"
  | "LOCAL_LOG_CLEANED"
  | "DR_PREVIEW"
  | "DR_STATE_REPORT";

export interface CalibrationVector3 {
  x: number;
  y: number;
  z: number;
}

export interface CalibrationQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CalibrationPose {
  position: CalibrationVector3;
  rotation: CalibrationQuaternion;
}

export interface CalibrationTagSample {
  tagId: number;
  acceptedCount: number;
  rejectedCount: number;
  positionRmsMeters: number;
  rotationRmsDegrees: number;
}

export interface CalibrationTagTransform {
  tagId: number;
  poseInKeyboardRig: CalibrationPose;
}

export interface CalibrationReport {
  attemptId: string;
  status: "PASS" | "FAIL";
  startedAtUtc: string;
  completedAtUtc: string;
  durationMs: number;
  tagFamily: "tagStandard41h12";
  tagSizeMeters: number;
  thresholdProfile: string;
  cameraPosition: "LEFT" | "RIGHT" | "UNKNOWN";
  imageWidth: number;
  imageHeight: number;
  observedTagIds: number[];
  tagSamples: CalibrationTagSample[];
  acceptedObservationCount: number;
  rejectedObservationCount: number;
  keyboardSpacingMeters: number | null;
  keyboardSpacingResidualMeters: number | null;
  tvPlanarityRmsMeters: number | null;
  keyboardRigInWorld: CalibrationPose | null;
  tvInKeyboardRig: CalibrationPose | null;
  tagTransforms: CalibrationTagTransform[];
  failureReasons: string[];
  warnings: string[];
  rawFramesPersisted: false;
  simulation: boolean;
}

export interface DiminishedRealityStateReport {
  requestedAction: string;
  target: DistractorType | null;
  profileVersion: string;
  requestedEnabled: boolean;
  actualState:
    | "HIDDEN"
    | "NO_DR"
    | "PREPARED"
    | "VISIBLE"
    | "REVEALED"
    | "FAIL_SAFE"
    | "ERROR";
  prepared: boolean;
  maskVisible: boolean;
  debugBoundsVisible: boolean;
  geometryActive: boolean;
  calibrationAttemptId: string | null;
  calibrationStatus: CalibrationStatus;
  drStateMatches: boolean;
  measuredFps: number | null;
  performanceTargetFps: 72;
  performanceGateEvaluated: boolean;
  performanceGatePass: boolean | null;
  reason: string | null;
}

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
  deviceId: QuestDeviceId;
  participantId: string;
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
  approvedQuestBuildId: string;
  trialDurationSeconds: typeof TRIAL_TIME_LIMIT_SECONDS;
  asymmetricRecipient: Role;
  deviceAssignments: DeviceAssignment[];
  calibrationPolicy: {
    manualOverrideAllowed: true;
    thresholdProfile: string | null;
  };
  schedulePath: string;
  scheduleSha256: string;
}

export interface PairingCodeView {
  deviceId: QuestDeviceId;
  code: string;
  expiresAtUtc: string;
}

export interface EnrollmentRequest {
  pairingCode: string;
  clientInstanceId: string;
  protocolVersion: string;
  appBuildId: string;
}

export interface EnrollmentResult {
  sessionId: string;
  deviceId: QuestDeviceId;
  participantId: string;
  role: Role;
  accessToken: string;
  websocketUrl: string;
  protocolVersion: string;
  approvedQuestBuildId: string;
}

export interface LocalLogStatus {
  sessionId: string;
  retained: boolean;
  recordCount: number;
  sha256: string | null;
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

export interface ParticipantRoleAssignment {
  slot: ParticipantSlot;
  role: Role;
}

export interface CounterbalanceAllocation {
  allocationId: string;
  pairId: string;
  participantRoleAssignments: ParticipantRoleAssignment[];
  asymmetricRecipient: Role;
  schedule: Schedule;
  reservePuzzleIds: string[];
}

export interface CounterbalancePlan {
  schemaVersion: typeof SCHEMA_VERSION;
  planId: string;
  planVersion: number;
  generatedAtUtc: string;
  randomizationSeed: string;
  validation: {
    status: "PASS";
    validatedAtUtc: string;
    checks: string[];
  };
  allocations: CounterbalanceAllocation[];
}

export interface SessionSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  sessionId: string;
  stateVersion: number;
  lastEventSequence: number;
  createdAtUtc: string;
  createdAtMonotonicMs: number;
  laptopState: LaptopState;
  activeTrialId: string | null;
  currentTrialIndex: number;
  trialStartedAtUtc: string | null;
  trialStartedAtMonotonicMs: number | null;
  submissionCount: number;
  outcome: TrialOutcome | null;
  completedTrialIds: string[];
  preflight: {
    directorQuestConnected: boolean;
    builderQuestConnected: boolean;
    recordingReady: boolean;
    storageReady: boolean;
    physicalDistractorConfirmed: boolean;
  };
  questStates: Array<{
    deviceId: string;
    state: QuestState;
    lastAppliedStateVersion: number;
  }>;
  recovery: {
    required: boolean;
    interruptedState: LaptopState | null;
    reason: string | null;
  };
}
