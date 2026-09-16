import type {
  CalibrationStatus,
  CalibrationReport,
  CounterbalanceAllocation,
  LaptopState,
  QuestDeviceId,
  QuestState,
  Role,
  SessionConfig,
  TrialDefinition,
  TrialOutcome,
  DiminishedRealityStateReport,
  DrPreviewAction,
  DistractorType,
} from "./contracts.js";

export const PREFLIGHT_KEYS = [
  "directorQuestConnected",
  "builderQuestConnected",
  "recordingReady",
  "storageReady",
  "physicalDistractorConfirmed",
] as const;

export type PreflightKey = (typeof PREFLIGHT_KEYS)[number];
export type PreflightStatus = Record<PreflightKey, boolean>;

export interface DeviceRuntimeStatus {
  deviceId: QuestDeviceId;
  participantId: string | null;
  role: Role | null;
  connected: boolean;
  simulation: boolean;
  state: QuestState;
  calibrationStatus: CalibrationStatus;
  lastHeartbeatAtUtc: string | null;
  lastAppliedStateVersion: number;
  clockOffsetMs: number | null;
  roundTripMs: number | null;
  faultStartedAtUtc: string | null;
}

export interface ActiveFault {
  faultId: string;
  source: string;
  message: string;
  raisedAtUtc: string;
  critical: boolean;
}

export interface TimerView {
  running: boolean;
  timeLimitMs: number;
  elapsedMs: number;
  limitReached: boolean;
  overrunMs: number;
}

export interface TrialRuntimeView {
  definition: TrialDefinition;
  submissionCount: number;
  outcome: TrialOutcome | null;
}

export interface ExportValidationReport {
  valid: boolean;
  checkedAtUtc: string;
  issues: string[];
  warnings: string[];
  counts: {
    scheduled: number;
    completed: number;
    invalid: number;
    replacements: number;
  };
}

export interface RecoveryView {
  required: boolean;
  interruptedState: LaptopState | null;
  reason: string | null;
}

export type LiveReconnectPhase =
  | "DISCONNECTED"
  | "AWAITING_SNAPSHOT"
  | "AWAITING_EXPERIMENTER_CONFIRMATION";

export interface LiveReconnectStatus {
  deviceId: QuestDeviceId;
  phase: LiveReconnectPhase;
  disconnectDurationMs: number | null;
  snapshotStateVersion: number | null;
  snapshotHash: string | null;
}

export interface EnrollmentRuntimeStatus {
  deviceId: QuestDeviceId;
  paired: boolean;
  clientInstanceId: string | null;
  protocolVersion: string | null;
  appBuildId: string | null;
  simulation: boolean;
  pairingCodeExpiresAtUtc: string | null;
}

export interface LocalLogRuntimeStatus {
  deviceId: QuestDeviceId;
  retained: boolean;
  recordCount: number;
  sha256: string | null;
  reportedAtUtc: string;
}

export interface DeviceCalibrationReport {
  deviceId: QuestDeviceId;
  participantId: string | null;
  role: Role | null;
  receivedAtUtc: string;
  report: CalibrationReport;
}

export interface DeviceDrStateReport {
  deviceId: QuestDeviceId;
  receivedAtUtc: string;
  report: DiminishedRealityStateReport;
}

export interface DrPreviewView {
  enabled: boolean;
  profileVersion: string;
  reports: DeviceDrStateReport[];
}

export interface CalibrationComparisonView {
  status: "NOT_RUN" | "PASS" | "FAIL" | "DEFERRED";
  comparedDeviceIds: QuestDeviceId[];
  tvPositionDifferenceMeters: number | null;
  tvRotationDifferenceDegrees: number | null;
  reason: string | null;
}

export interface ServerConnectionView {
  bindHost: string;
  port: number;
  advertisedHttpUrl: string;
  advertisedWebSocketUrl: string;
  approvedQuestBuildId: string;
  protocolVersion: string;
}

export interface DashboardState {
  schemaVersion: "1.4.0";
  serverTimeUtc: string;
  serverConnection: ServerConnectionView;
  laptopState: LaptopState;
  stateVersion: number;
  session: {
    config: SessionConfig;
    allocationId: string;
    scheduleId: string;
  } | null;
  currentTrialIndex: number;
  currentTrial: TrialRuntimeView | null;
  completedTrialIds: string[];
  devices: DeviceRuntimeStatus[];
  enrollments: EnrollmentRuntimeStatus[];
  liveReconnects: LiveReconnectStatus[];
  localLogs: LocalLogRuntimeStatus[];
  calibrationReports: DeviceCalibrationReport[];
  calibrationComparison: CalibrationComparisonView;
  drPreview: DrPreviewView;
  preflight: PreflightStatus;
  timer: TimerView;
  faults: ActiveFault[];
  recovery: RecoveryView;
  exportValidation: ExportValidationReport | null;
  availableActions: string[];
}

export interface CreateSessionInput {
  pairId: string;
  participantAId: string;
  participantBId: string;
}

export interface LoadedAllocation {
  allocation: CounterbalanceAllocation;
  sourcePlanPath: string;
}

export interface GuardedActionInput {
  confirmed: boolean;
  reason?: string;
}

export interface DrPreviewCommandInput {
  action: DrPreviewAction;
  target: DistractorType;
  debugBounds?: boolean;
}
