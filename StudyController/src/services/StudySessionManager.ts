import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type WebSocket from "ws";

import { sha256CanonicalJson } from "../canonicalJson.js";
import type { Clock } from "../clock.js";
import { isoNow, systemClock } from "../clock.js";
import {
  APRILTAG_DETECTION_SIZE_METERS,
  CALIBRATION_THRESHOLD_PROFILE,
  DEFAULT_APPROVED_QUEST_BUILD_ID,
  DR_PROFILE_VERSION,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  TRIAL_TIME_LIMIT_SECONDS,
  type CalibrationQuaternion,
  type CalibrationReport,
  type CounterbalanceAllocation,
  type EnrollmentRequest,
  type EnrollmentResult,
  type LaptopState,
  type LocalLogStatus,
  type PairingCodeView,
  type QuestDeviceId,
  type QuestState,
  type RuntimeDecision,
  type Schedule,
  type SessionConfig,
  type SessionSnapshot,
  type TrialDefinition,
  type TrialOutcome,
  type DiminishedRealityStateReport,
} from "../contracts.js";
import {
  evaluateCriticalDisconnect,
  evaluateSubmitAttempt,
} from "../protocolRules.js";
import {
  PREFLIGHT_KEYS,
  type ActiveFault,
  type CreateSessionInput,
  type DashboardState,
  type CalibrationComparisonView,
  type DeviceCalibrationReport,
  type DeviceDrStateReport,
  type DrPreviewCommandInput,
  type ExportValidationReport,
  type GuardedActionInput,
  type LiveReconnectStatus,
  type LocalLogRuntimeStatus,
  type PreflightKey,
  type PreflightStatus,
  type QuestionnaireCompletion,
  type QuestionnaireGateView,
  type QuestionnaireKind,
  type RecoveryView,
} from "../runtimeTypes.js";
import { assertLaptopTransition } from "../stateMachines.js";
import {
  assertSchema,
  SCHEMA_IDS,
  validateScheduleSemantics,
  validateSessionSemantics,
} from "../validation.js";
import { AuthoritativeTimer } from "./AuthoritativeTimer.js";
import { writeArtifactManifest } from "./ArtifactManifest.js";
import { CommandCoordinator } from "./CommandCoordinator.js";
import { ConnectionWatchdog } from "./ConnectionWatchdog.js";
import {
  CounterbalanceScheduler,
  sha256Json,
} from "./CounterbalanceScheduler.js";
import { EventLogger } from "./EventLogger.js";
import {
  EnrollmentManager,
  type EnrollmentIdentity,
} from "./EnrollmentManager.js";
import { ExportValidator } from "./ExportValidator.js";
import type {
  MediaArtifact,
  MediaReadiness,
  MediaCapture,
} from "./ObsMediaController.js";
import {
  SnapshotManager,
  writeJsonAtomic,
} from "./SnapshotManager.js";

export interface StudySessionManagerOptions {
  dataRoot: string;
  counterbalancePlanPath: string;
  clock?: Clock;
  startLeadMs?: number;
  bindHost?: string;
  initialPort?: number;
  advertisedHost?: string;
  approvedQuestBuildId?: string;
  pairingCodeTtlMs?: number;
  drPreviewEnabled?: boolean;
  questionnaireGateEnabled?: boolean;
  questionnaireUrls?: Partial<Record<QuestionnaireKind, string>>;
  obsMedia?: MediaCapture;
  obsCaptureConfigurationSha256?: string;
  onStateChanged?: (state: DashboardState) => void;
}

function emptyPreflight(): PreflightStatus {
  return {
    directorQuestConnected: false,
    builderQuestConnected: false,
    recordingReady: false,
    storageReady: false,
    physicalDistractorConfirmed: false,
  };
}

function quaternionAngleDegrees(
  left: CalibrationQuaternion,
  right: CalibrationQuaternion,
): number {
  const leftMagnitude = Math.hypot(left.x, left.y, left.z, left.w);
  const rightMagnitude = Math.hypot(right.x, right.y, right.z, right.w);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 180;
  }
  const dot = Math.abs(
    (left.x * right.x +
      left.y * right.y +
      left.z * right.z +
      left.w * right.w) /
      (leftMagnitude * rightMagnitude),
  );
  return (2 * Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

export class StudySessionManager {
  private readonly clock: Clock;
  private readonly scheduler: CounterbalanceScheduler;
  private readonly exportValidator = new ExportValidator();
  private readonly timer: AuthoritativeTimer;
  private readonly startLeadMs: number;
  private readonly enrollment: EnrollmentManager;
  private readonly bindHost: string;
  private readonly advertisedHost: string;
  private readonly approvedQuestBuildId: string;
  private readonly drPreviewEnabled: boolean;
  private readonly questionnaireGateEnabled: boolean;
  private readonly questionnaireUrls: Partial<Record<QuestionnaireKind, string>>;
  private readonly questionnaireCompletions = new Map<string, QuestionnaireCompletion>();
  private readonly obsMedia: MediaCapture | null;
  private mediaReadiness: MediaReadiness | null = null;
  private mediaRecordingTrialId: string | null = null;
  private interruptedRecordingTrialId: string | null = null;
  private readonly mediaArtifacts = new Map<string, MediaArtifact>();
  private serverPort: number;
  private readonly onStateChanged:
    | ((state: DashboardState) => void)
    | undefined;

  public readonly watchdog: ConnectionWatchdog;
  public readonly coordinator: CommandCoordinator;

  private laptopState: LaptopState = "SERVER_READY";
  private stateVersion = 0;
  private sessionConfig: SessionConfig | null = null;
  private allocation: CounterbalanceAllocation | null = null;
  private schedule: Schedule | null = null;
  private sessionDirectory: string | null = null;
  private sessionClosed = false;
  private legacyWorkflowPolicy = false;
  private eventLogger: EventLogger | null = null;
  private snapshotManager: SnapshotManager | null = null;
  private currentTrialIndex = 0;
  private activeTrialId: string | null = null;
  private submissionCount = 0;
  private lastRuntimeDecision: RuntimeDecision | null = null;
  private lateCorrectCompletionMs: number | null = null;
  private outcome: TrialOutcome | null = null;
  private completedTrialIds: string[] = [];
  private trialStartedAtUtc: string | null = null;
  private trialStartedAtMonotonicMs: number | null = null;
  private preflight: PreflightStatus = emptyPreflight();
  private recovery: RecoveryView = {
    required: false,
    interruptedState: null,
    reason: null,
  };
  private readonly faults = new Map<string, ActiveFault>();
  private readonly liveReconnects = new Map<QuestDeviceId, LiveReconnectStatus>();
  private readonly localLogs = new Map<QuestDeviceId, LocalLogRuntimeStatus>();
  private readonly calibrationReports =
    new Map<QuestDeviceId, DeviceCalibrationReport>();
  private readonly calibrationOverrideReasons =
    new Map<QuestDeviceId, string>();
  private readonly drStateReports =
    new Map<QuestDeviceId, DeviceDrStateReport>();
  private calibrationComparison: CalibrationComparisonView = {
    status: "NOT_RUN",
    comparedDeviceIds: [],
    tvPositionDifferenceMeters: null,
    tvRotationDifferenceDegrees: null,
    reason: null,
  };
  private exportValidation: ExportValidationReport | null = null;
  private stoppingTrial = false;
  private criticalInvalidationPending = false;
  private timeLimitEventRecorded = false;

  public constructor(private readonly options: StudySessionManagerOptions) {
    this.clock = options.clock ?? systemClock;
    this.startLeadMs = options.startLeadMs ?? 250;
    this.bindHost = options.bindHost ?? "127.0.0.1";
    this.serverPort = options.initialPort ?? 4317;
    this.advertisedHost = options.advertisedHost ?? this.bindHost;
    this.approvedQuestBuildId =
      options.approvedQuestBuildId ?? DEFAULT_APPROVED_QUEST_BUILD_ID;
    this.drPreviewEnabled = options.drPreviewEnabled === true;
    this.questionnaireGateEnabled = options.questionnaireGateEnabled === true;
    this.questionnaireUrls = options.questionnaireUrls ?? {};
    for (const formUrl of Object.values(this.questionnaireUrls)) {
      if (formUrl === undefined) continue;
      const parsed = new URL(formUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Questionnaire URLs must use HTTP or HTTPS.");
      }
    }
    this.obsMedia = options.obsMedia ?? null;
    this.enrollment =
      options.pairingCodeTtlMs === undefined
        ? new EnrollmentManager(this.clock)
        : new EnrollmentManager(this.clock, options.pairingCodeTtlMs);
    this.onStateChanged = options.onStateChanged;
    this.scheduler = new CounterbalanceScheduler(
      options.counterbalancePlanPath,
    );
    this.timer = new AuthoritativeTimer(this.clock);
    this.watchdog = new ConnectionWatchdog(
      {
        onChanged: () => {
          this.updateConnectionPreflight();
          this.publish();
        },
        onFaultRaised: (deviceId, message) => {
          this.markLiveDisconnect(deviceId);
          return this.raiseFault(deviceId, message, true);
        },
        onFaultCleared: (deviceId) => this.clearFault(deviceId),
        onCriticalTimeout: (deviceId, durationMs) =>
          this.handleCriticalTimeout(deviceId, durationMs),
      },
      this.clock,
    );
    this.coordinator = new CommandCoordinator(
      this.watchdog,
      {
        onFault: (deviceId, payload) =>
          this.raiseFault(
            deviceId,
            String(payload.detail ?? "Quest reported a fault."),
            payload.critical === true,
          ),
        onConnectionRegistered: (deviceId, observation) =>
          this.handleConnectionRegistered(
            deviceId,
            observation.reconnectDurationMs,
          ),
        onSnapshotApplied: (deviceId, observation, result) =>
          this.handleSnapshotApplied(
            deviceId,
            observation.reconnectDurationMs,
            result.appliedStateVersion,
            result.snapshotHash,
          ),
        onLocalLogStatus: (deviceId, status) =>
          this.recordLocalLogStatus(deviceId, status),
      },
      this.clock,
    );
  }

  public async createSession(input: CreateSessionInput): Promise<DashboardState> {
    if (this.sessionConfig !== null || this.laptopState !== "SERVER_READY") {
      throw new Error("A study session is already active.");
    }

    const loaded = await this.scheduler.selectForPair(input.pairId);
    this.allocation = loaded.allocation;
    this.schedule = structuredClone(loaded.allocation.schedule);
    const roleA = loaded.allocation.participantRoleAssignments.find(
      ({ slot }) => slot === "A",
    )!.role;
    const roleB = loaded.allocation.participantRoleAssignments.find(
      ({ slot }) => slot === "B",
    )!.role;
    const sessionId = randomUUID();
    const sessionDirectory = path.join(this.options.dataRoot, input.pairId);

    try {
      await access(path.join(sessionDirectory, "session-config.json"));
      throw new Error(
        `${input.pairId} already has a session directory; existing data will not be overwritten.`,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    const config: SessionConfig = {
      schemaVersion: SCHEMA_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      studyId: "CDR",
      sessionId,
      pairId: input.pairId,
      createdAtUtc: isoNow(this.clock),
      approvedQuestBuildId: this.approvedQuestBuildId,
      trialDurationSeconds: TRIAL_TIME_LIMIT_SECONDS,
      asymmetricRecipient: loaded.allocation.asymmetricRecipient,
      deviceAssignments: [
        {
          deviceId: "QUEST_A",
          participantId: input.participantAId,
          role: roleA,
          accessTokenRef: "runtime-secrets/quest-a",
        },
        {
          deviceId: "QUEST_B",
          participantId: input.participantBId,
          role: roleB,
          accessTokenRef: "runtime-secrets/quest-b",
        },
      ],
      calibrationPolicy: {
        manualOverrideAllowed: true,
        thresholdProfile: CALIBRATION_THRESHOLD_PROFILE,
      },
      schedulePath: "schedule.json",
      scheduleSha256: sha256Json(this.schedule),
    };
    assertSchema(SCHEMA_IDS.sessionConfig, config);
    const configIssues = validateSessionSemantics(config);
    const scheduleIssues = validateScheduleSemantics(this.schedule);
    if (configIssues.length > 0 || scheduleIssues.length > 0) {
      throw new Error([...configIssues, ...scheduleIssues].join("\n"));
    }

    await writeJsonAtomic(
      path.join(sessionDirectory, "session-config.json"),
      config,
    );
    await writeJsonAtomic(
      path.join(sessionDirectory, "schedule.json"),
      this.schedule,
    );
    await writeJsonAtomic(path.join(sessionDirectory, "workflow-policy.json"), {
      schemaVersion: "1.0.0",
      obsRequired: this.obsMedia !== null,
      ...(this.options.obsCaptureConfigurationSha256 === undefined
        ? {} : { obsCaptureConfigurationSha256: this.options.obsCaptureConfigurationSha256 }),
      questionnaireGateRequired: this.questionnaireGateEnabled,
      formLinksSha256: sha256CanonicalJson(this.questionnaireUrls),
      createdAtUtc: isoNow(this.clock),
    });

    this.sessionConfig = config;
    this.sessionDirectory = sessionDirectory;
    this.eventLogger = await EventLogger.open(
      sessionDirectory,
      sessionId,
      this.clock,
    );
    this.snapshotManager = new SnapshotManager(
      this.options.dataRoot,
      sessionDirectory,
    );
    this.enrollment.configure(config);
    this.watchdog.configure(config.deviceAssignments);
    this.configureCoordinator();
    this.watchdog.start();

    await this.eventLogger.append({
      trialId: null,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "SESSION_CREATED",
      payload: {
        pairId: input.pairId,
        allocationId: loaded.allocation.allocationId,
        counterbalancePlanPath: path.basename(loaded.sourcePlanPath),
      },
    });
    await this.transition("SESSION_SETUP");
    await this.snapshotManager.writeActivePointer({
      sessionId,
      pairId: input.pairId,
      relativeDirectory: input.pairId,
      closed: false,
    });
    return this.getDashboardState();
  }

  public async restoreActiveSession(): Promise<boolean> {
    if (this.sessionConfig !== null) {
      throw new Error("Cannot restore over an active session.");
    }
    const pointer = await SnapshotManager.loadActivePointer(
      this.options.dataRoot,
    );
    if (pointer === null || pointer.closed) {
      return false;
    }

    const sessionDirectory = path.join(
      this.options.dataRoot,
      pointer.relativeDirectory,
    );
    const config = JSON.parse(
      await readFile(path.join(sessionDirectory, "session-config.json"), "utf8"),
    ) as SessionConfig;
    const schedule = JSON.parse(
      await readFile(path.join(sessionDirectory, config.schedulePath), "utf8"),
    ) as Schedule;
    let policy: {
      obsRequired: boolean;
      obsCaptureConfigurationSha256?: string;
      questionnaireGateRequired: boolean;
      formLinksSha256?: string;
    };
    try {
      policy = JSON.parse(
        await readFile(path.join(sessionDirectory, "workflow-policy.json"), "utf8"),
      ) as typeof policy;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (Date.parse(config.createdAtUtc) >= Date.parse("2026-10-06T00:00:00Z")) {
        throw new Error("Active session is missing its workflow policy file.");
      }
      this.legacyWorkflowPolicy = true;
      policy = { obsRequired: false, questionnaireGateRequired: false };
    }
    if (
      policy.obsRequired !== (this.obsMedia !== null) ||
      (policy.obsCaptureConfigurationSha256 !== undefined &&
        policy.obsCaptureConfigurationSha256 !== this.options.obsCaptureConfigurationSha256) ||
      policy.questionnaireGateRequired !== this.questionnaireGateEnabled ||
      (policy.formLinksSha256 !== undefined &&
        policy.formLinksSha256 !== sha256CanonicalJson(this.questionnaireUrls))
    ) {
      throw new Error(
        "Active session media/questionnaire policy differs from this server configuration. Restart with the original capture settings, modes, and form links.",
      );
    }
    assertSchema(SCHEMA_IDS.sessionConfig, config);
    assertSchema(SCHEMA_IDS.schedule, schedule);

    const loaded = await this.scheduler.selectForPair(config.pairId);
    this.sessionConfig = config;
    this.schedule = schedule;
    this.allocation = loaded.allocation;
    this.sessionDirectory = sessionDirectory;
    this.eventLogger = await EventLogger.open(
      sessionDirectory,
      config.sessionId,
      this.clock,
    );
    this.snapshotManager = new SnapshotManager(
      this.options.dataRoot,
      sessionDirectory,
    );
    this.enrollment.configure(config);
    const snapshot = await this.snapshotManager.loadLatest();
    if (snapshot === null || snapshot.sessionId !== config.sessionId) {
      throw new Error("Active session has no compatible recovery snapshot.");
    }

    this.laptopState = snapshot.laptopState;
    this.stateVersion = snapshot.stateVersion;
    this.activeTrialId = snapshot.activeTrialId;
    this.currentTrialIndex = snapshot.currentTrialIndex;
    this.trialStartedAtUtc = snapshot.trialStartedAtUtc;
    this.trialStartedAtMonotonicMs = snapshot.trialStartedAtMonotonicMs;
    this.submissionCount = snapshot.submissionCount;
    this.outcome = snapshot.outcome;
    this.completedTrialIds = [...snapshot.completedTrialIds];
    this.preflight = { ...snapshot.preflight };
    if (this.obsMedia !== null) {
      // A prior process's readiness evidence cannot authorize a new process.
      this.preflight.recordingReady = false;
      this.preflight.storageReady = false;
    }
    this.recovery = { ...snapshot.recovery };
    for (const event of await this.eventLogger.readAll()) {
      if (event.eventType === "MEDIA_STATUS_RECORDED") {
        const media = event.payload as { action?: string; artifact?: MediaArtifact };
        if (media.action === "RECORDING_STARTED" && event.trialId !== null) {
          this.interruptedRecordingTrialId = event.trialId;
        }
        if (media.action === "RECORDING_SAVED" && media.artifact !== undefined) {
          this.mediaArtifacts.set(media.artifact.trialId, media.artifact);
          if (this.interruptedRecordingTrialId === media.artifact.trialId) {
            this.interruptedRecordingTrialId = null;
          }
        }
      }
      if (event.eventType !== "EXPERIMENTER_ACTION") {
        continue;
      }
      const payload = event.payload as Partial<QuestionnaireCompletion> & {
        action?: string;
      };
      if (
        payload.action === "QUESTIONNAIRE_COMPLETED" &&
        payload.kind !== undefined &&
        payload.participantId !== undefined &&
        payload.scopeId !== undefined
      ) {
        const completion: QuestionnaireCompletion = {
          kind: payload.kind,
          participantId: payload.participantId,
          scopeId: payload.scopeId,
          recordedAtUtc: event.recordedAtUtc,
        };
        this.questionnaireCompletions.set(
          this.questionnaireKey(completion),
          completion,
        );
      }
    }

    this.watchdog.configure(config.deviceAssignments);
    this.configureCoordinator();
    this.watchdog.start();

    if (
      this.laptopState === "TRIAL_COMMITTED" ||
      this.laptopState === "TRIAL_ACTIVE" ||
      this.laptopState === "TRIAL_STOPPING"
    ) {
      const interruptedState = this.laptopState;
      this.recovery = {
        required: true,
        interruptedState,
        reason:
          "The server restarted during a committed or active trial. The stopwatch was not resumed.",
      };
      await this.transition("RECOVERY_REQUIRED");
    } else {
      this.publish();
    }
    return true;
  }

  public setListeningPort(port: number): void {
    this.serverPort = port;
    this.publish();
  }

  public async issuePairingCode(
    deviceId: QuestDeviceId,
  ): Promise<PairingCodeView> {
    const view = this.enrollment.issuePairingCode(deviceId);
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "PAIRING_CODE_ISSUED",
      payload: { deviceId, expiresAtUtc: view.expiresAtUtc },
    });
    this.publish();
    return view;
  }

  public async redeemPairingCode(
    request: EnrollmentRequest,
  ): Promise<EnrollmentResult> {
    const issued = this.enrollment.redeem(request);
    await this.recordEnrollment(issued.identity);
    return this.enrollmentResult(issued.identity, issued.accessToken);
  }

  public async enrollSimulation(
    deviceId: QuestDeviceId,
  ): Promise<{ identity: EnrollmentIdentity; accessToken: string }> {
    const issued = this.enrollment.enrollSimulation(deviceId);
    await this.recordEnrollment(issued.identity);
    return issued;
  }

  public releaseSimulationEnrollment(deviceId: QuestDeviceId): void {
    this.enrollment.releaseSimulation(deviceId);
    this.publish();
  }

  public authenticateQuestBearer(accessToken: string): EnrollmentIdentity {
    return this.enrollment.authenticate(accessToken);
  }

  public registerQuestSocket(
    identity: EnrollmentIdentity,
    socket: WebSocket,
  ): Promise<void> {
    return this.coordinator.registerSocket(identity, socket);
  }

  public async beginPreflight(): Promise<DashboardState> {
    if (
      this.laptopState !== "SESSION_SETUP" &&
      this.laptopState !== "BLOCKED" &&
      this.laptopState !== "CONDITION_REVIEW"
    ) {
      throw new Error(`Cannot begin preflight from ${this.laptopState}.`);
    }
    if (this.laptopState === "CONDITION_REVIEW") {
      if (this.questionnaireGateEnabled) {
        throw new Error("Complete condition review before beginning the next preflight.");
      }
      this.requireQuestionnaireGateComplete();
    }
    if (this.laptopState === "SESSION_SETUP") {
      this.requireQuestionnaireGateComplete();
    }
    this.preflight = emptyPreflight();
    this.mediaReadiness = null;
    this.updateConnectionPreflight();
    await this.transition("PREFLIGHT");
    return this.getDashboardState();
  }

  public async setPreflightItem(
    key: PreflightKey,
    value: boolean,
  ): Promise<DashboardState> {
    if (this.laptopState !== "PREFLIGHT") {
      throw new Error("Preflight items can only be changed during PREFLIGHT.");
    }
    if (
      key === "directorQuestConnected" ||
      key === "builderQuestConnected"
    ) {
      throw new Error("Quest connection checks are controlled by the server.");
    }
    if (this.obsMedia !== null && (key === "recordingReady" || key === "storageReady")) {
      throw new Error("OBS recording and storage checks are controlled by the media check.");
    }
    this.preflight[key] = value;
    await this.requireLogger().append({
      trialId: this.currentTrial()?.trialId ?? null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPERIMENTER_ACTION",
      payload: { action: "SET_PREFLIGHT_ITEM", key, value },
    });
    await this.persistSnapshot();
    return this.getDashboardState();
  }

  public async confirmPreflight(): Promise<DashboardState> {
    if (this.laptopState !== "PREFLIGHT") {
      throw new Error("Preflight is not active.");
    }
    this.updateConnectionPreflight();
    if (this.obsMedia !== null) {
      await this.checkMedia();
    }
    const missing = PREFLIGHT_KEYS.filter((key) => !this.preflight[key]);
    if (missing.length > 0) {
      throw new Error(`Preflight is incomplete: ${missing.join(", ")}.`);
    }
    await this.requireLogger().append({
      trialId: this.currentTrial()?.trialId ?? null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "PREFLIGHT_CONFIRMED",
      payload: { checks: this.preflight },
    });
    this.calibrationReports.clear();
    this.calibrationOverrideReasons.clear();
    this.calibrationComparison = {
      status: "NOT_RUN",
      comparedDeviceIds: [],
      tvPositionDifferenceMeters: null,
      tvRotationDifferenceDegrees: null,
      reason: null,
    };
    for (const device of this.watchdog.list()) {
      this.watchdog.setCalibration(device.deviceId, "NOT_RUN");
    }
    await this.transition("CALIBRATION");
    return this.getDashboardState();
  }

  public async checkMedia(): Promise<DashboardState> {
    if (this.obsMedia === null) {
      throw new Error("OBS media control is not configured.");
    }
    if (this.laptopState !== "PREFLIGHT") {
      throw new Error("OBS media checks are available only during PREFLIGHT.");
    }
    try {
      this.mediaReadiness = await this.obsMedia.inspect(this.requireSessionDirectory());
    } catch (error) {
      this.mediaReadiness = {
        mode: "OBS",
        checkedAtUtc: isoNow(this.clock),
        ready: false,
        cameraSource: "",
        cameraActive: false,
        microphones: [],
        availableBytes: 0,
        storageReady: false,
        recordDirectory: "",
        issues: [error instanceof Error ? error.message : String(error)],
      };
    }
    this.preflight.recordingReady = this.mediaReadiness.ready;
    this.preflight.storageReady = this.mediaReadiness.storageReady;
    await this.requireLogger().append({
      trialId: this.currentTrial()?.trialId ?? null,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "MEDIA_STATUS_RECORDED",
      payload: {
        action: "READINESS_CHECKED",
        ready: this.mediaReadiness.ready,
        cameraActive: this.mediaReadiness.cameraActive,
        microphones: this.mediaReadiness.microphones,
        availableBytes: this.mediaReadiness.availableBytes,
        issues: this.mediaReadiness.issues,
      },
    });
    this.publish();
    return this.getDashboardState();
  }

  public async mediaPreview(): Promise<string> {
    if (this.obsMedia === null || this.laptopState !== "PREFLIGHT") {
      throw new Error("OBS camera preview is available only during media preflight.");
    }
    return this.obsMedia.cameraPreview();
  }

  public async recoverInterruptedRecording(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    const trialId = this.interruptedRecordingTrialId;
    if (this.obsMedia === null || trialId === null) {
      throw new Error("No interrupted OBS recording is pending recovery.");
    }
    if (!["RECOVERY_REQUIRED", "POST_TRIAL", "BLOCKED"].includes(this.laptopState)) {
      throw new Error("OBS recording recovery is not allowed in this state.");
    }
    try {
      const artifact = await this.obsMedia.recover(trialId, this.requireSessionDirectory());
      this.mediaArtifacts.set(trialId, artifact);
      this.interruptedRecordingTrialId = null;
      await this.requireLogger().append({
        trialId,
        stateVersion: this.stateVersion,
        source: "DASHBOARD",
        eventType: "MEDIA_STATUS_RECORDED",
        payload: {
          action: "RECORDING_SAVED",
          artifact,
          recoveredAfterInterruption: true,
          reason: input.reason,
        },
      });
      await this.clearFault("OBS");
      this.exportValidation = null;
      this.publish();
      return this.getDashboardState();
    } catch (error) {
      await this.raiseFault(
        "OBS",
        `Interrupted recording recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
      throw error;
    }
  }

  public async runCalibration(): Promise<DashboardState> {
    if (this.laptopState !== "CALIBRATION") {
      throw new Error("Calibration is not active.");
    }
    const devices = this.watchdog.list();
    if (devices.length !== 2 || devices.some(({ connected }) => !connected)) {
      throw new Error("Both assigned Quest slots must be connected for calibration.");
    }

    const attemptId = randomUUID();
    this.calibrationReports.clear();
    this.calibrationOverrideReasons.clear();
    this.calibrationComparison = {
      status: "NOT_RUN",
      comparedDeviceIds: [],
      tvPositionDifferenceMeters: null,
      tvRotationDifferenceDegrees: null,
      reason: null,
    };
    for (const device of devices) {
      this.watchdog.setCalibration(device.deviceId, "NOT_RUN");
      this.watchdog.setState(
        device.deviceId,
        "CALIBRATING",
        device.lastAppliedStateVersion,
      );
    }
    await this.requireLogger().append({
      trialId: this.currentTrial()?.trialId ?? null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "CALIBRATION_STARTED",
      payload: {
        attemptId,
        durationMs: 6_000,
        tagFamily: "tagStandard41h12",
        tagSizeMeters: APRILTAG_DETECTION_SIZE_METERS,
        requiredTagIds: [1, 2, 3, 4, 5, 6],
        minimumVisibleTvTags: 3,
        thresholdProfile: CALIBRATION_THRESHOLD_PROFILE,
      },
    });

    let results: Awaited<ReturnType<CommandCoordinator["runCalibration"]>>;
    try {
      results = await this.coordinator.runCalibration(attemptId);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Calibration command failed.";
      for (const device of devices) {
        this.watchdog.setCalibration(device.deviceId, "FAIL");
      }
      this.calibrationComparison = {
        status: "FAIL",
        comparedDeviceIds: devices.map(({ deviceId }) => deviceId),
        tvPositionDifferenceMeters: null,
        tvRotationDifferenceDegrees: null,
        reason,
      };
      await this.requireLogger().append({
        trialId: this.currentTrial()?.trialId ?? null,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "CALIBRATION_COMMAND_FAILED",
        payload: { attemptId, reason },
      });
      await this.persistSnapshot();
      throw error;
    }
    for (const result of results) {
      const device = devices.find(
        ({ deviceId }) => deviceId === result.deviceId,
      );
      if (device === undefined) {
        throw new Error(`Calibration returned unknown device ${result.deviceId}.`);
      }
      const report = this.validateCalibrationReport(
        result.report,
        attemptId,
        device.simulation,
      );
      const received: DeviceCalibrationReport = {
        deviceId: result.deviceId,
        participantId: device.participantId,
        role: device.role,
        receivedAtUtc: isoNow(this.clock),
        report,
      };
      this.calibrationReports.set(result.deviceId, received);
      this.watchdog.setCalibration(result.deviceId, report.status);
      await this.requireLogger().append({
        trialId: this.currentTrial()?.trialId ?? null,
        stateVersion: this.stateVersion,
        source: result.deviceId,
        eventType: "CALIBRATION_RECORDED",
        payload: { ...report },
      });
    }

    this.calibrationComparison = this.compareCalibrationReports();
    if (this.calibrationComparison.status === "FAIL") {
      for (const device of devices) {
        this.watchdog.setCalibration(device.deviceId, "FAIL");
      }
    }
    await this.requireLogger().append({
      trialId: this.currentTrial()?.trialId ?? null,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "CALIBRATION_COMPATIBILITY_EVALUATED",
      payload: { ...this.calibrationComparison },
    });
    await this.persistSnapshot();
    return this.getDashboardState();
  }

  public async simulateCalibrationPass(): Promise<DashboardState> {
    if (this.laptopState !== "CALIBRATION") {
      throw new Error("Calibration is not active.");
    }
    const devices = this.watchdog.list();
    if (devices.some(({ simulation }) => !simulation)) {
      throw new Error(
        "Simulated calibration cannot be applied while a physical Quest is enrolled.",
      );
    }
    for (const device of devices) {
      this.watchdog.setCalibration(device.deviceId, "PASS");
      await this.requireLogger().append({
        trialId: this.currentTrial()?.trialId ?? null,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "CALIBRATION_RECORDED",
        payload: {
          deviceId: device.deviceId,
          status: "PASS",
          simulated: true,
        },
      });
    }
    this.calibrationComparison = {
      status: "DEFERRED",
      comparedDeviceIds: devices.map(({ deviceId }) => deviceId),
      tvPositionDifferenceMeters: null,
      tvRotationDifferenceDegrees: null,
      reason: "Calibration was simulated; no physical compatibility claim is made.",
    };
    await this.persistSnapshot();
    return this.getDashboardState();
  }

  public async overrideCalibration(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    if (this.laptopState !== "CALIBRATION") {
      throw new Error("Calibration is not active.");
    }
    for (const device of this.watchdog.list()) {
      this.watchdog.setCalibration(device.deviceId, "OVERRIDDEN");
      this.calibrationOverrideReasons.set(
        device.deviceId,
        input.reason ?? "Recorded calibration override.",
      );
      await this.requireLogger().append({
        trialId: this.currentTrial()?.trialId ?? null,
        stateVersion: this.stateVersion,
        source: "DASHBOARD",
        eventType: "CALIBRATION_RECORDED",
        payload: {
          deviceId: device.deviceId,
          status: "OVERRIDDEN",
          reason: input.reason,
        },
      });
    }
    this.calibrationComparison = {
      status: "DEFERRED",
      comparedDeviceIds: this.watchdog.list().map(({ deviceId }) => deviceId),
      tvPositionDifferenceMeters: null,
      tvRotationDifferenceDegrees: null,
      reason: "Calibration was manually overridden with a recorded reason.",
    };
    await this.persistSnapshot();
    return this.getDashboardState();
  }

  public async prepareCurrentTrial(): Promise<DashboardState> {
    if (this.laptopState !== "CALIBRATION") {
      throw new Error("A trial can only be prepared after calibration.");
    }
    if (!this.watchdog.allConnectedAndReady()) {
      throw new Error("Both Quests must be connected and calibrated.");
    }
    const trial = this.requireCurrentTrial();
    this.activeTrialId = trial.trialId;
    this.outcome = null;
    this.submissionCount = 0;
    this.lastRuntimeDecision = null;
    this.lateCorrectCompletionMs = null;
    await this.transition("TRIAL_PREPARED");

    try {
      const calibrationByDevice = Object.fromEntries(
        this.watchdog.list().map((device) => {
          if (
            device.calibrationStatus !== "PASS" &&
            device.calibrationStatus !== "OVERRIDDEN"
          ) {
            throw new Error(`${device.deviceId} is not calibrated.`);
          }
          return [
            device.deviceId,
            {
              status: device.calibrationStatus,
              overrideReason:
                device.calibrationStatus === "OVERRIDDEN"
                  ? this.calibrationOverrideReasons.get(device.deviceId) ??
                    "Recorded calibration override."
                  : null,
            },
          ];
        }),
      ) as Parameters<CommandCoordinator["prepareTrial"]>[1];
      await this.coordinator.prepareTrial(trial, calibrationByDevice);
      await this.requireLogger().append({
        trialId: trial.trialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "TRIAL_PREPARED",
        payload: {
          condition: trial.condition,
          distractorType: trial.distractorType,
          puzzleId: trial.puzzleId,
        },
      });
      await this.persistSnapshot();
      return this.getDashboardState();
    } catch (error) {
      await this.raiseFault(
        "COMMAND_COORDINATOR",
        error instanceof Error ? error.message : "Trial preparation failed.",
        true,
      );
      await this.transition("BLOCKED");
      throw error;
    }
  }

  public async previewDiminishedReality(
    input: DrPreviewCommandInput,
  ): Promise<DashboardState> {
    if (!this.drPreviewEnabled) {
      throw new Error(
        "The researcher DR preview panel is disabled. Restart with DR_PREVIEW_ENABLED=true for placement testing.",
      );
    }
    if (this.laptopState !== "CALIBRATION") {
      throw new Error(
        "DR preview is available only after preflight and before a trial is prepared.",
      );
    }
    if (!this.watchdog.allConnectedAndReady()) {
      throw new Error("Both Quest slots must be connected and calibrated.");
    }
    if (
      !["PREPARE", "SHOW", "HIDE", "REVEAL", "SET_DEBUG_BOUNDS", "REPORT"].includes(
        input.action,
      )
    ) {
      throw new Error(`Unsupported DR preview action: ${String(input.action)}.`);
    }
    if (input.target !== "TV" && input.target !== "KEYBOARD") {
      throw new Error("DR preview target must be TV or KEYBOARD.");
    }
    if (
      input.action === "SET_DEBUG_BOUNDS" &&
      typeof input.debugBounds !== "boolean"
    ) {
      throw new Error("SET_DEBUG_BOUNDS requires a boolean debugBounds value.");
    }

    const responses = await this.coordinator.previewDiminishedReality(input);
    for (const { deviceId, report } of responses) {
      this.validateDrStateReport(report, input.action, input.target);
      this.drStateReports.set(deviceId, {
        deviceId,
        receivedAtUtc: isoNow(this.clock),
        report: structuredClone(report),
      });
    }
    await this.requireLogger().append({
      trialId: null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "DR_PREVIEW_COMMAND_COMPLETED",
      payload: {
        action: input.action,
        target: input.target,
        debugBounds: input.debugBounds ?? null,
        profileVersion: DR_PROFILE_VERSION,
        deviceStates: responses.map(({ deviceId, report }) => ({
          deviceId,
          actualState: report.actualState,
          drStateMatches: report.drStateMatches,
          measuredFps: report.measuredFps,
        })),
      },
    });
    this.publish();
    return this.getDashboardState();
  }

  public async startTrial(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, false);
    if (this.laptopState !== "TRIAL_PREPARED") {
      throw new Error("The trial is not prepared.");
    }
    const trial = this.requireCurrentTrial();
    await this.transition("TRIAL_COMMITTED");
    let startStage: "OBS" | "COMMAND_COORDINATOR" =
      this.obsMedia === null ? "COMMAND_COORDINATOR" : "OBS";

    try {
      if (this.obsMedia !== null) {
        this.mediaReadiness = await this.obsMedia.inspect(this.requireSessionDirectory());
        if (!this.mediaReadiness.ready) {
          throw new Error(`OBS is not ready: ${this.mediaReadiness.issues.join("; ")}`);
        }
        await this.obsMedia.start(trial.trialId, this.requireSessionDirectory());
        this.mediaRecordingTrialId = trial.trialId;
        this.interruptedRecordingTrialId = trial.trialId;
        await this.requireLogger().append({
          trialId: trial.trialId,
          stateVersion: this.stateVersion,
          source: "SERVER",
          eventType: "MEDIA_STATUS_RECORDED",
          payload: { action: "RECORDING_STARTED", trialId: trial.trialId },
        });
      }
      const startAtMonotonicMs = this.clock.monotonicNow() + this.startLeadMs;
      const startAtUtc = new Date(
        this.clock.utcNow().getTime() + this.startLeadMs,
      ).toISOString();
      startStage = "COMMAND_COORDINATOR";
      await this.coordinator.commitStart(
        trial.trialId,
        startAtUtc,
        startAtMonotonicMs,
      );
      await this.requireLogger().append({
        trialId: trial.trialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "TRIAL_COMMITTED",
        payload: { startAtUtc, startAtMonotonicMs },
      });
      const waitMs = Math.max(
        0,
        startAtMonotonicMs - this.clock.monotonicNow(),
      );
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      this.trialStartedAtUtc = startAtUtc;
      this.trialStartedAtMonotonicMs = startAtMonotonicMs;
      this.timeLimitEventRecorded = false;
      this.timer.start(TRIAL_TIME_LIMIT_SECONDS * 1_000, () =>
        this.handleTimeLimitReached(),
      );
      await this.transition("TRIAL_ACTIVE");
      await this.requireLogger().append({
        trialId: trial.trialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "TRIAL_STARTED",
        payload: { timeLimitMs: TRIAL_TIME_LIMIT_SECONDS * 1_000 },
      });
      this.publish();
      return this.getDashboardState();
    } catch (error) {
      this.timer.stop();
      if (this.obsMedia?.isRecordingTrial(trial.trialId) === true) {
        try {
          const artifact = await this.obsMedia.stop(trial.trialId);
          this.mediaArtifacts.set(trial.trialId, artifact);
          this.interruptedRecordingTrialId = null;
          await this.requireLogger().append({
            trialId: trial.trialId,
            stateVersion: this.stateVersion,
            source: "SERVER",
            eventType: "MEDIA_STATUS_RECORDED",
            payload: { action: "RECORDING_SAVED", artifact, interruptedStart: true },
          });
        } catch (stopError) {
          await this.raiseFault("OBS", `Recording cleanup failed: ${String(stopError)}`, true);
        } finally {
          this.mediaRecordingTrialId = null;
        }
      }
      await this.raiseFault(
        startStage,
        error instanceof Error ? error.message : "Trial start failed.",
        true,
      );
      if ((this.laptopState as LaptopState) === "TRIAL_COMMITTED") {
        await this.transition("BLOCKED");
      }
      throw error;
    }
  }

  public async recordSubmission(
    runtimeDecision: RuntimeDecision,
  ): Promise<DashboardState> {
    this.requireNoLiveReconnect();
    const timer = this.timer.view();
    if (timer.limitReached) {
      await this.handleTimeLimitReached();
    }
    const decision = evaluateSubmitAttempt(
      this.laptopState,
      this.submissionCount,
      this.submissionCount + 1,
      runtimeDecision,
    );
    if (!decision.accepted) {
      throw new Error(decision.reason);
    }

    const trial = this.requireCurrentTrial();
    const elapsedMs = timer.elapsedMs;
    const afterTimeLimit = timer.limitReached;
    this.submissionCount = decision.nextSubmissionCount;
    this.lastRuntimeDecision = runtimeDecision;
    await this.requireLogger().append({
      trialId: trial.trialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "SUBMISSION_RECORDED",
      payload: {
        attemptNumber: this.submissionCount,
        elapsedMs,
        runtimeDecision,
        afterTimeLimit,
      },
    });

    if (decision.emitStandardizedContinue) {
      await this.requireLogger().append({
        trialId: trial.trialId,
        stateVersion: this.stateVersion,
        source: "DASHBOARD",
        eventType: "STANDARDIZED_CONTINUE_GIVEN",
        payload: { attemptNumber: this.submissionCount },
      });
      this.publish();
      return this.getDashboardState();
    }

    if (afterTimeLimit) {
      this.lateCorrectCompletionMs = elapsedMs;
      await this.stopActiveTrial("TIMEOUT");
    } else {
      await this.stopActiveTrial("COMPLETED");
    }
    return this.getDashboardState();
  }

  public async endTrialAtTimeLimit(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, false);
    this.requireNoLiveReconnect();
    if (this.laptopState !== "TRIAL_ACTIVE") {
      throw new Error("The trial is not active.");
    }
    const currentTimer = this.timer.view();
    if (!currentTimer.limitReached) {
      throw new Error("The 420-second time limit has not been reached.");
    }
    const timer = this.timer.stop();
    await this.handleTimeLimitReached();
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPERIMENTER_ACTION",
      payload: {
        action: "END_TRIAL_TIME_LIMIT",
        timeLimitMs: timer.timeLimitMs,
        elapsedMs: timer.elapsedMs,
        overrunMs: timer.overrunMs,
      },
    });
    await this.stopActiveTrial("TIMEOUT");
    return this.getDashboardState();
  }

  public async invalidateActiveTrial(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPERIMENTER_ACTION",
      payload: {
        action: "INVALIDATE_TRIAL",
        reason: input.reason,
      },
    });
    await this.stopActiveTrial("TECHNICAL_INVALID");
    return this.getDashboardState();
  }

  public async abortActiveTrial(
    outcome: "PARTICIPANT_WITHDRAWAL" | "EXPERIMENTER_ABORTED",
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPERIMENTER_ACTION",
      payload: { action: outcome, reason: input.reason },
    });
    await this.stopActiveTrial(outcome);
    return this.getDashboardState();
  }

  public async completePostTrial(): Promise<DashboardState> {
    if (this.laptopState !== "POST_TRIAL") {
      throw new Error("The controller is not in POST_TRIAL.");
    }
    if (this.interruptedRecordingTrialId !== null) {
      throw new Error("Recover the interrupted OBS recording before advancing.");
    }
    if (
      this.outcome === "PARTICIPANT_WITHDRAWAL" ||
      this.outcome === "EXPERIMENTER_ABORTED"
    ) {
      await this.transition("SESSION_COMPLETE");
      return this.getDashboardState();
    }

    this.requireQuestionnaireGateComplete();

    const previous = this.requireCurrentTrial();
    this.currentTrialIndex += 1;
    this.submissionCount = 0;
    this.lastRuntimeDecision = null;
    this.lateCorrectCompletionMs = null;
    this.timeLimitEventRecorded = false;
    this.outcome = null;
    this.trialStartedAtUtc = null;
    this.trialStartedAtMonotonicMs = null;
    this.timer.reset();

    const next = this.currentTrial();
    if (next === null) {
      if (this.questionnaireGateEnabled && previous.blockIndex !== null) {
        await this.transition("CONDITION_REVIEW");
      } else {
        await this.transition("SESSION_COMPLETE");
      }
    } else if (
      previous.kind !== "PRACTICE" &&
      previous.blockIndex !== next.blockIndex
    ) {
      await this.transition("CONDITION_REVIEW");
    } else {
      this.preflight = emptyPreflight();
      this.updateConnectionPreflight();
      await this.transition("PREFLIGHT");
    }
    return this.getDashboardState();
  }

  public async recordQuestionnaireCompletion(
    kind: QuestionnaireKind,
    participantId: string,
  ): Promise<DashboardState> {
    if (!this.questionnaireGateEnabled) {
      throw new Error("Questionnaire completion tracking is disabled.");
    }
    const gate = this.questionnaireGateView();
    if (gate.pending !== kind || gate.scopeId === null) {
      throw new Error(`No ${kind} questionnaire is due in ${this.laptopState}.`);
    }
    if (!gate.participantIds.includes(participantId)) {
      throw new Error("Participant ID is not assigned to this session.");
    }
    const completion: QuestionnaireCompletion = {
      kind,
      participantId,
      scopeId: gate.scopeId,
      recordedAtUtc: isoNow(this.clock),
    };
    const key = this.questionnaireKey(completion);
    if (this.questionnaireCompletions.has(key)) {
      return this.getDashboardState();
    }
    await this.requireLogger().append({
      trialId: kind === "POST_TRIAL" ? gate.scopeId : null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPERIMENTER_ACTION",
      payload: {
        action: "QUESTIONNAIRE_COMPLETED",
        kind,
        participantId,
        scopeId: gate.scopeId,
      },
    });
    this.questionnaireCompletions.set(key, completion);
    this.exportValidation = null;
    this.publish();
    return this.getDashboardState();
  }

  public async completeConditionReview(): Promise<DashboardState> {
    if (this.laptopState !== "CONDITION_REVIEW") {
      throw new Error("No condition review is pending.");
    }
    this.requireQuestionnaireGateComplete();
    if (this.currentTrial() === null) {
      await this.transition("SESSION_COMPLETE");
    } else {
      this.preflight = emptyPreflight();
      this.updateConnectionPreflight();
      await this.transition("PREFLIGHT");
    }
    return this.getDashboardState();
  }

  public async resolveRecovery(
    outcome: "TECHNICAL_INVALID" | "PARTICIPANT_WITHDRAWAL" | "EXPERIMENTER_ABORTED",
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    if (this.laptopState !== "RECOVERY_REQUIRED" || !this.recovery.required) {
      throw new Error("No recovery decision is pending.");
    }
    if (this.interruptedRecordingTrialId !== null) {
      throw new Error("Recover the interrupted OBS recording before resolving the trial.");
    }
    const trial = this.currentTrial();
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "RECOVERY_RESOLVED",
      payload: { outcome, reason: input.reason },
    });

    if (trial !== null && this.activeTrialId !== null) {
      await this.recordOutcomeEvent(trial, outcome);
      if (!this.completedTrialIds.includes(trial.trialId)) {
        this.completedTrialIds.push(trial.trialId);
      }
      if (outcome === "TECHNICAL_INVALID" && trial.kind !== "PRACTICE") {
        await this.scheduleReplacement(trial);
      }
      this.currentTrialIndex += 1;
    }

    this.outcome = outcome;
    this.activeTrialId = null;
    this.trialStartedAtUtc = null;
    this.trialStartedAtMonotonicMs = null;
    this.timer.reset();
    this.recovery = {
      required: false,
      interruptedState: null,
      reason: null,
    };

    if (
      outcome === "PARTICIPANT_WITHDRAWAL" ||
      outcome === "EXPERIMENTER_ABORTED"
    ) {
      await this.transition("SESSION_COMPLETE");
    } else {
      this.outcome = null;
      this.submissionCount = 0;
      this.lateCorrectCompletionMs = null;
      this.preflight = emptyPreflight();
      this.updateConnectionPreflight();
      await this.transition("PREFLIGHT");
    }
    return this.getDashboardState();
  }

  public async confirmReconnectContinuation(
    deviceId: QuestDeviceId,
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, false);
    if (this.laptopState !== "TRIAL_ACTIVE") {
      throw new Error("Reconnect continuation is only valid during an active trial.");
    }
    const reconnect = this.liveReconnects.get(deviceId);
    if (
      reconnect?.phase !== "AWAITING_EXPERIMENTER_CONFIRMATION" ||
      reconnect.snapshotStateVersion === null ||
      reconnect.snapshotHash === null
    ) {
      throw new Error(`${deviceId} has no validated snapshot awaiting confirmation.`);
    }
    if (reconnect.snapshotStateVersion !== this.stateVersion) {
      throw new Error("The validated snapshot is stale; reconnect the Quest again.");
    }

    await this.coordinator.continueAfterRecovery(
      deviceId,
      reconnect.snapshotStateVersion,
      reconnect.snapshotHash,
    );
    this.watchdog.confirmRecovered(deviceId, "TRIAL_ACTIVE");
    this.liveReconnects.delete(deviceId);
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "RECONNECT_CONTINUATION_CONFIRMED",
      payload: {
        deviceId,
        disconnectDurationMs: reconnect.disconnectDurationMs,
        snapshotStateVersion: reconnect.snapshotStateVersion,
        snapshotHash: reconnect.snapshotHash,
      },
    });
    this.publish();
    return this.getDashboardState();
  }

  public async cleanupQuestLocalLogs(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, false);
    if (this.laptopState !== "SESSION_COMPLETE") {
      throw new Error("Quest backup logs can only be cleaned after session completion.");
    }
    if (this.sessionClosed) {
      throw new Error("Quest backup logs must be cleaned before closing the session.");
    }
    if (this.exportValidation?.valid !== true) {
      throw new Error("Validate the laptop export before cleaning Quest backup logs.");
    }

    for (const { deviceId } of this.requireConfig().deviceAssignments) {
      let status = this.localLogs.get(deviceId);
      if (status === undefined) {
        await this.coordinator.requestLocalLogStatus(deviceId);
        status = this.localLogs.get(deviceId);
      }
      if (status === undefined || !status.retained) {
        continue;
      }
      await this.coordinator.cleanupLocalLog(deviceId, status.sha256);
      const cleaned: LocalLogRuntimeStatus = {
        ...status,
        retained: false,
        recordCount: 0,
        sha256: null,
        reportedAtUtc: isoNow(this.clock),
      };
      this.localLogs.set(deviceId, cleaned);
      await this.requireLogger().append({
        trialId: null,
        stateVersion: this.stateVersion,
        source: "DASHBOARD",
        eventType: "QUEST_LOCAL_LOG_CLEANED",
        payload: { deviceId, priorSha256: status.sha256 },
      });
    }
    this.exportValidation = null;
    this.publish();
    return this.getDashboardState();
  }

  public async validateExports(
    requireComplete = this.laptopState === "SESSION_COMPLETE",
  ): Promise<ExportValidationReport> {
    const events = await this.requireLogger().readAll();
    const config = this.requireConfig();
    const schedule = this.requireSchedule();
    const report = this.exportValidator.validate(
      config,
      schedule,
      events,
      this.completedTrialIds,
      requireComplete,
    );
    const startedTrialIds = events
      .filter((event) => event.eventType === "TRIAL_STARTED" && event.trialId !== null)
      .map((event) => event.trialId!);
    if (this.obsMedia !== null) {
      for (const trialId of startedTrialIds) {
        if (!this.mediaArtifacts.has(trialId)) {
          report.issues.push(`Started trial ${trialId} has no OBS media artifact.`);
        }
      }
    }
    if (requireComplete && this.questionnaireGateEnabled) {
      const gate = this.questionnaireGateView();
      const missing = gate.participantIds.filter(
        (participantId) => !gate.completedParticipantIds.includes(participantId),
      );
      if (gate.pending !== null && missing.length > 0) {
        report.issues.push(
          `${gate.pending} questionnaire completion is missing for ${missing.join(", ")}.`,
        );
        report.valid = false;
      }
    }
    await this.exportValidator.writeTrialSummary(
      this.requireSessionDirectory(),
      config,
      schedule,
      events,
    );
    report.valid = report.issues.length === 0;
    this.exportValidation = report;
    await this.requireLogger().append({
      trialId: null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "EXPORT_VALIDATED",
      payload: {
        valid: report.valid,
        issueCount: report.issues.length,
        warningCount: report.warnings.length,
      },
    });
    let manifest = await writeArtifactManifest(
      this.requireSessionDirectory(),
      this.obsMedia !== null,
      startedTrialIds,
      [...this.mediaArtifacts.values()],
      this.legacyWorkflowPolicy,
    );
    const newIssues = manifest.issues.filter((issue) => !report.issues.includes(issue));
    if (newIssues.length > 0) {
      report.issues.push(...newIssues);
      report.valid = false;
      await this.requireLogger().append({
        trialId: null,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "EXPORT_VALIDATED",
        payload: {
          valid: false,
          issueCount: report.issues.length,
          warningCount: report.warnings.length,
        },
      });
      manifest = await writeArtifactManifest(
        this.requireSessionDirectory(),
        this.obsMedia !== null,
        startedTrialIds,
        [...this.mediaArtifacts.values()],
        this.legacyWorkflowPolicy,
      );
    }
    this.publish();
    return report;
  }

  public async closeSession(
    input: GuardedActionInput,
  ): Promise<DashboardState> {
    this.requireGuard(input, true);
    if (this.laptopState !== "SESSION_COMPLETE") {
      throw new Error("The session is not complete.");
    }
    if (this.sessionClosed) {
      throw new Error("The session has already been closed.");
    }
    this.requireQuestionnaireGateComplete();
    const terminalEarly =
      this.outcome === "PARTICIPANT_WITHDRAWAL" ||
      this.outcome === "EXPERIMENTER_ABORTED";
    const report = await this.validateExports(!terminalEarly);
    if (!report.valid) {
      throw new Error(
        `Export validation failed:\n${report.issues.join("\n")}`,
      );
    }
    await this.requireLogger().append({
      trialId: null,
      stateVersion: this.stateVersion,
      source: "DASHBOARD",
      eventType: "SESSION_CLOSED",
      payload: { reason: input.reason },
    });
    try {
      const finalEvents = await this.requireLogger().readAll();
      const finalManifest = await writeArtifactManifest(
        this.requireSessionDirectory(),
        this.obsMedia !== null,
        finalEvents
          .filter((event) => event.eventType === "TRIAL_STARTED" && event.trialId !== null)
          .map((event) => event.trialId!),
        [...this.mediaArtifacts.values()],
        this.legacyWorkflowPolicy,
      );
      if (finalManifest.issues.length > 0) {
        throw new Error(finalManifest.issues.join("; "));
      }
      await this.requireSnapshotManager().writeActivePointer({
        sessionId: this.requireConfig().sessionId,
        pairId: this.requireConfig().pairId,
        relativeDirectory: this.requireConfig().pairId,
        closed: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.raiseFault("EXPORT", `Final artifact manifest failed: ${reason}`, true);
      await this.requireLogger().append({
        trialId: null,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "EXPERIMENTER_ACTION",
        payload: { action: "SESSION_CLOSE_INCOMPLETE", reason },
      });
      this.exportValidation = null;
      throw new Error(`Final artifact manifest failed: ${reason}`);
    }
    this.sessionClosed = true;
    this.coordinator.closeAll();
    this.watchdog.stop();
    this.publish();
    return this.getDashboardState();
  }

  public getDashboardState(): DashboardState {
    const trial = this.currentTrial();
    return {
      schemaVersion: SCHEMA_VERSION,
      serverTimeUtc: isoNow(this.clock),
      serverConnection: this.serverConnectionView(),
      laptopState: this.laptopState,
      stateVersion: this.stateVersion,
      session:
        this.sessionConfig === null || this.allocation === null
          ? null
          : {
              config: structuredClone(this.sessionConfig),
              allocationId: this.allocation.allocationId,
              scheduleId: this.schedule?.scheduleId ?? "",
              closed: this.sessionClosed,
            },
      currentTrialIndex: this.currentTrialIndex,
      currentTrial:
        trial === null
          ? null
          : {
              definition: structuredClone(trial),
              submissionCount: this.submissionCount,
              outcome: this.outcome,
            },
      completedTrialIds: [...this.completedTrialIds],
      devices: this.watchdog.list(),
      enrollments: this.sessionConfig === null ? [] : this.enrollment.list(),
      liveReconnects: [...this.liveReconnects.values()].map((entry) => ({
        ...entry,
      })),
      localLogs: [...this.localLogs.values()].map((entry) => ({ ...entry })),
      calibrationReports: [...this.calibrationReports.values()].map((entry) =>
        structuredClone(entry),
      ),
      calibrationComparison: structuredClone(this.calibrationComparison),
      drPreview: {
        enabled: this.drPreviewEnabled,
        profileVersion: DR_PROFILE_VERSION,
        reports: [...this.drStateReports.values()].map((entry) =>
          structuredClone(entry),
        ),
      },
      preflight: { ...this.preflight },
      media: {
        mode: this.obsMedia === null ? "SIMULATED" : "OBS",
        readiness: this.mediaReadiness === null ? null : structuredClone(this.mediaReadiness),
        recordingTrialId: this.mediaRecordingTrialId,
        interruptedRecordingTrialId: this.interruptedRecordingTrialId,
        artifacts: [...this.mediaArtifacts.values()].map((artifact) => ({ ...artifact })),
      },
      questionnaireGate: this.questionnaireGateView(),
      timer: this.timer.view(),
      faults: [...this.faults.values()].map((fault) => ({ ...fault })),
      recovery: { ...this.recovery },
      exportValidation:
        this.exportValidation === null
          ? null
          : structuredClone(this.exportValidation),
      availableActions: this.availableActions(),
    };
  }

  public shutdown(): void {
    this.timer.stop();
    this.watchdog.stop();
    this.coordinator.closeAll();
  }

  private async stopActiveTrial(outcome: TrialOutcome): Promise<void> {
    if (this.laptopState !== "TRIAL_ACTIVE" || this.stoppingTrial) {
      throw new Error("No active trial can be stopped.");
    }
    this.stoppingTrial = true;
    const trial = this.requireCurrentTrial();
    this.timer.stop();
    try {
      await this.transition("TRIAL_STOPPING");
      try {
        await this.coordinator.stopTrial(trial.trialId, outcome);
      } catch (error) {
        await this.raiseFault(
          "COMMAND_COORDINATOR",
          error instanceof Error ? error.message : "Quest stop failed.",
          true,
        );
      }

      if (this.obsMedia !== null) {
        try {
          const artifact = await this.obsMedia.stop(trial.trialId);
          this.mediaArtifacts.set(trial.trialId, artifact);
          this.mediaRecordingTrialId = null;
          this.interruptedRecordingTrialId = null;
          await this.requireLogger().append({
            trialId: trial.trialId,
            stateVersion: this.stateVersion,
            source: "SERVER",
            eventType: "MEDIA_STATUS_RECORDED",
            payload: { action: "RECORDING_SAVED", artifact },
          });
        } catch (error) {
          this.mediaRecordingTrialId = null;
          await this.raiseFault(
            "OBS",
            `Recording failed for ${trial.trialId}: ${error instanceof Error ? error.message : String(error)}`,
            true,
          );
          await this.requireLogger().append({
            trialId: trial.trialId,
            stateVersion: this.stateVersion,
            source: "SERVER",
            eventType: "MEDIA_STATUS_RECORDED",
            payload: { action: "RECORDING_FAILED", reason: String(error) },
          });
          if (outcome === "COMPLETED" || outcome === "TIMEOUT") {
            outcome = "TECHNICAL_INVALID";
          }
        }
      }

      await this.requireLogger().append({
        trialId: trial.trialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "TRIAL_STOPPED",
        payload: { outcome },
      });
      await this.recordOutcomeEvent(trial, outcome);
      if (!this.completedTrialIds.includes(trial.trialId)) {
        this.completedTrialIds.push(trial.trialId);
      }
      if (
        (outcome === "TECHNICAL_INVALID" ||
          outcome === "PROTOCOL_INVALID") &&
        trial.kind !== "PRACTICE"
      ) {
        await this.scheduleReplacement(trial);
      }

      this.outcome = outcome;
      this.activeTrialId = null;
      this.liveReconnects.clear();
      this.trialStartedAtUtc = null;
      this.trialStartedAtMonotonicMs = null;
      await this.transition("POST_TRIAL");
    } finally {
      this.stoppingTrial = false;
    }
  }

  private async recordOutcomeEvent(
    trial: TrialDefinition,
    outcome: TrialOutcome,
  ): Promise<void> {
    const timer = this.timer.view();
    await this.requireLogger().append({
      trialId: trial.trialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "TRIAL_OUTCOME_RECORDED",
      payload: {
        outcome,
        submissionCount: this.submissionCount,
        liveFinalAccuracy:
          outcome === "COMPLETED"
            ? "CORRECT"
            : this.lastRuntimeDecision ?? null,
        verifiedFinalAccuracy: null,
        elapsedMs: timer.timeLimitMs > 0 ? timer.elapsedMs : null,
        completedAfterTimeLimit: this.lateCorrectCompletionMs !== null,
        lateCorrectCompletionMs: this.lateCorrectCompletionMs,
      },
    });
  }

  private async scheduleReplacement(trial: TrialDefinition): Promise<void> {
    const allocation = this.requireAllocation();
    const replacement = this.scheduler.createReplacement(
      allocation,
      this.requireSchedule(),
      trial.trialId,
    );
    this.schedule = this.scheduler.appendReplacement(
      this.requireSchedule(),
      replacement,
    );
    this.sessionConfig = {
      ...this.requireConfig(),
      scheduleSha256: sha256Json(this.schedule),
    };
    assertSchema(SCHEMA_IDS.schedule, this.schedule);
    assertSchema(SCHEMA_IDS.sessionConfig, this.sessionConfig);
    await writeJsonAtomic(
      path.join(this.requireSessionDirectory(), "schedule.json"),
      this.schedule,
    );
    await writeJsonAtomic(
      path.join(this.requireSessionDirectory(), "session-config.json"),
      this.sessionConfig,
    );
    await this.requireLogger().append({
      trialId: trial.trialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "REPLACEMENT_SCHEDULED",
      payload: {
        replacementTrialId: replacement.trialId,
        puzzleId: replacement.puzzleId,
        replacementForTrialId: trial.trialId,
      },
    });
  }

  private async handleTimeLimitReached(): Promise<void> {
    if (
      this.laptopState !== "TRIAL_ACTIVE" ||
      this.stoppingTrial ||
      this.timeLimitEventRecorded
    ) {
      return;
    }
    this.timeLimitEventRecorded = true;
    const timer = this.timer.view();
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "TIME_LIMIT_REACHED",
      payload: {
        timeLimitMs: TRIAL_TIME_LIMIT_SECONDS * 1_000,
        observedElapsedMs: timer.elapsedMs,
      },
    });
    this.publish();
  }

  private markLiveDisconnect(deviceId: QuestDeviceId): void {
    if (this.laptopState !== "TRIAL_ACTIVE" || this.stoppingTrial) {
      return;
    }
    this.liveReconnects.set(deviceId, {
      deviceId,
      phase: "DISCONNECTED",
      disconnectDurationMs: null,
      snapshotStateVersion: null,
      snapshotHash: null,
    });
    this.publish();
  }

  private async handleConnectionRegistered(
    deviceId: QuestDeviceId,
    reconnectDurationMs: number | null,
  ): Promise<void> {
    if (reconnectDurationMs === null) {
      return;
    }
    if (evaluateCriticalDisconnect(reconnectDurationMs) === "INVALIDATE_TECHNICAL") {
      await this.handleCriticalTimeout(deviceId, reconnectDurationMs);
      return;
    }
    if (this.laptopState === "TRIAL_ACTIVE" && !this.stoppingTrial) {
      this.liveReconnects.set(deviceId, {
        deviceId,
        phase: "AWAITING_SNAPSHOT",
        disconnectDurationMs: reconnectDurationMs,
        snapshotStateVersion: null,
        snapshotHash: null,
      });
      this.publish();
    }
  }

  private async handleSnapshotApplied(
    deviceId: QuestDeviceId,
    reconnectDurationMs: number | null,
    appliedStateVersion: number,
    snapshotHash: string,
  ): Promise<void> {
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: deviceId,
      eventType: "STATE_SNAPSHOT_APPLIED",
      payload: { deviceId, appliedStateVersion, snapshotHash },
    });

    const reconnect = this.liveReconnects.get(deviceId);
    if (
      reconnectDurationMs !== null &&
      reconnect !== undefined &&
      this.laptopState === "TRIAL_ACTIVE"
    ) {
      reconnect.phase = "AWAITING_EXPERIMENTER_CONFIRMATION";
      reconnect.disconnectDurationMs = reconnectDurationMs;
      reconnect.snapshotStateVersion = appliedStateVersion;
      reconnect.snapshotHash = snapshotHash;
      this.liveReconnects.set(deviceId, reconnect);
    } else {
      const device = this.watchdog
        .list()
        .find((candidate) => candidate.deviceId === deviceId);
      if (device?.faultStartedAtUtc !== null && device?.faultStartedAtUtc !== undefined) {
        this.watchdog.confirmRecovered(
          deviceId,
          this.questStateForLaptopState(),
        );
      } else {
        this.watchdog.setState(
          deviceId,
          this.questStateForLaptopState(),
          appliedStateVersion,
        );
      }
    }
    this.publish();

    void this.coordinator.requestLocalLogStatus(deviceId).catch((error) =>
      this.raiseFault(
        `LOCAL_LOG_${deviceId}`,
        error instanceof Error
          ? error.message
          : `${deviceId} local-log status request failed.`,
        false,
      ),
    );
  }

  private async recordLocalLogStatus(
    deviceId: QuestDeviceId,
    status: LocalLogStatus,
  ): Promise<void> {
    if (status.sessionId !== this.requireConfig().sessionId) {
      throw new Error(`${deviceId} reported local-log status for another session.`);
    }
    const runtimeStatus: LocalLogRuntimeStatus = {
      deviceId,
      retained: status.retained,
      recordCount: status.recordCount,
      sha256: status.sha256,
      reportedAtUtc: isoNow(this.clock),
    };
    this.localLogs.set(deviceId, runtimeStatus);
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: deviceId,
      eventType: "QUEST_LOCAL_LOG_STATUS_RECORDED",
      payload: { deviceId, ...status },
    });
    this.publish();
  }

  private async handleCriticalTimeout(
    deviceId: QuestDeviceId,
    durationMs: number,
  ): Promise<void> {
    if (
      this.laptopState === "TRIAL_ACTIVE" &&
      !this.stoppingTrial &&
      !this.criticalInvalidationPending
    ) {
      this.criticalInvalidationPending = true;
      try {
        await this.requireLogger().append({
          trialId: this.activeTrialId,
          stateVersion: this.stateVersion,
          source: "SERVER",
          eventType: "EXPERIMENTER_ACTION",
          payload: {
            action: "INVALIDATE_TRIAL",
            reason: `${deviceId} critical fault persisted for ${Math.round(
              durationMs,
            )} ms.`,
            automatic: true,
          },
        });
        await this.stopActiveTrial("TECHNICAL_INVALID");
      } finally {
        this.criticalInvalidationPending = false;
      }
      return;
    }

    if (
      this.laptopState === "PREFLIGHT" ||
      this.laptopState === "CALIBRATION" ||
      this.laptopState === "TRIAL_PREPARED" ||
      this.laptopState === "TRIAL_COMMITTED"
    ) {
      await this.transition("BLOCKED");
    }
  }

  private async raiseFault(
    source: string,
    message: string,
    critical: boolean,
  ): Promise<void> {
    const prior = [...this.faults.values()].find(
      (fault) => fault.source === source,
    );
    if (prior !== undefined) {
      return;
    }
    const fault: ActiveFault = {
      faultId: randomUUID(),
      source,
      message,
      raisedAtUtc: isoNow(this.clock),
      critical,
    };
    this.faults.set(fault.faultId, fault);
    if (this.eventLogger !== null) {
      await this.eventLogger.append({
        trialId: this.activeTrialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "FAULT_RAISED",
        payload: { ...fault },
      });
    }
    this.publish();
  }

  private async clearFault(source: string): Promise<void> {
    const entry = [...this.faults.entries()].find(
      ([, fault]) => fault.source === source,
    );
    if (entry === undefined) {
      return;
    }
    this.faults.delete(entry[0]);
    if (this.eventLogger !== null) {
      await this.eventLogger.append({
        trialId: this.activeTrialId,
        stateVersion: this.stateVersion,
        source: "SERVER",
        eventType: "FAULT_CLEARED",
        payload: { source },
      });
    }
    this.publish();
  }

  private async transition(next: LaptopState): Promise<void> {
    assertLaptopTransition(this.laptopState, next);
    const previous = this.laptopState;
    this.laptopState = next;
    this.exportValidation = null;
    this.stateVersion += 1;
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "STATE_TRANSITION",
      payload: { from: previous, to: next },
    });
    await this.persistSnapshot();
  }

  private async persistSnapshot(): Promise<void> {
    const manager = this.requireSnapshotManager();
    const logger = this.requireLogger();
    const snapshot: SessionSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: this.requireConfig().sessionId,
      stateVersion: this.stateVersion,
      lastEventSequence: logger.lastSequence,
      createdAtUtc: isoNow(this.clock),
      createdAtMonotonicMs: this.clock.monotonicNow(),
      laptopState: this.laptopState,
      activeTrialId: this.activeTrialId,
      currentTrialIndex: this.currentTrialIndex,
      trialStartedAtUtc: this.trialStartedAtUtc,
      trialStartedAtMonotonicMs: this.trialStartedAtMonotonicMs,
      submissionCount: this.submissionCount,
      outcome: this.outcome,
      completedTrialIds: [...this.completedTrialIds],
      preflight: { ...this.preflight },
      questStates: this.watchdog.list().map((device) => ({
        deviceId: device.deviceId,
        state: device.state,
        lastAppliedStateVersion: device.lastAppliedStateVersion,
      })),
      recovery: { ...this.recovery },
    };
    const relativePath = await manager.write(snapshot);
    await logger.append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "SNAPSHOT_WRITTEN",
      payload: { relativePath },
    });
    this.publish();
  }

  private configureCoordinator(): void {
    this.coordinator.configure({
      sessionConfig: this.requireConfig(),
      getStateVersion: () => this.stateVersion,
      getTrialId: () => this.activeTrialId,
      getStateSnapshot: (deviceId) => this.getTargetedStateSnapshot(deviceId),
      eventLogger: this.requireLogger(),
    });
  }

  private getTargetedStateSnapshot(
    deviceId: QuestDeviceId,
  ): Record<string, unknown> {
    const config = this.requireConfig();
    const assignment = config.deviceAssignments.find(
      (candidate) => candidate.deviceId === deviceId,
    );
    if (assignment === undefined) {
      throw new Error(`Unknown Quest slot: ${deviceId}.`);
    }
    const trial = this.activeTrialId === null ? null : this.currentTrial();
    const trialCanApplyDr =
      trial !== null &&
      (this.laptopState === "TRIAL_PREPARED" ||
        this.laptopState === "TRIAL_COMMITTED" ||
        this.laptopState === "TRIAL_ACTIVE");
    const drEnabled =
      trialCanApplyDr &&
      (trial.condition === "SYMMETRIC_DR" ||
        (trial.condition === "ASYMMETRIC_DR" &&
          assignment.role === config.asymmetricRecipient));
    const failSafeRequired =
      this.outcome === "TECHNICAL_INVALID" ||
      this.laptopState === "RECOVERY_REQUIRED";

    return {
      laptopState: this.laptopState,
      stateVersion: this.stateVersion,
      activeTrialId: this.activeTrialId,
      trialStartedAtUtc: this.trialStartedAtUtc,
      trialStartedAtMonotonicMs: this.trialStartedAtMonotonicMs,
      outcome: this.outcome,
      assignment: {
        deviceId: assignment.deviceId,
        participantId: assignment.participantId,
        role: assignment.role,
      },
      currentTrial: trial === null ? null : structuredClone(trial),
      trialConfigurationHash:
        trial === null ? null : sha256CanonicalJson(trial),
      desiredQuestState: this.questStateForLaptopState(),
      drEnabled: failSafeRequired ? false : drEnabled,
      drTarget: trial?.distractorType ?? null,
      drProfileVersion: DR_PROFILE_VERSION,
      calibrationStatus:
        this.watchdog.list().find((candidate) => candidate.deviceId === deviceId)
          ?.calibrationStatus ?? "NOT_RUN",
      failSafeRequired,
      reconnectConfirmationRequired: this.liveReconnects.has(deviceId),
      timer: this.timer.view(),
    };
  }

  private questStateForLaptopState(): QuestState {
    switch (this.laptopState) {
      case "TRIAL_PREPARED":
        return "TRIAL_PREPARED";
      case "TRIAL_COMMITTED":
        return "TRIAL_COMMITTED";
      case "TRIAL_ACTIVE":
        return "TRIAL_ACTIVE";
      case "TRIAL_STOPPING":
        return "STOPPING";
      case "RECOVERY_REQUIRED":
        return "RECOVERING";
      case "CALIBRATION":
        return "CALIBRATING";
      default:
        return "IDLE";
    }
  }

  private async recordEnrollment(identity: EnrollmentIdentity): Promise<void> {
    await this.requireLogger().append({
      trialId: this.activeTrialId,
      stateVersion: this.stateVersion,
      source: "SERVER",
      eventType: "DEVICE_ENROLLED",
      payload: {
        deviceId: identity.deviceId,
        participantId: identity.participantId,
        role: identity.role,
        clientInstanceId: identity.clientInstanceId,
        protocolVersion: identity.protocolVersion,
        appBuildId: identity.appBuildId,
        simulation: identity.simulation,
      },
    });
    this.publish();
  }

  private enrollmentResult(
    identity: EnrollmentIdentity,
    accessToken: string,
  ): EnrollmentResult {
    const config = this.requireConfig();
    return {
      sessionId: config.sessionId,
      deviceId: identity.deviceId,
      participantId: identity.participantId,
      role: identity.role,
      accessToken,
      websocketUrl: `${this.serverConnectionView().advertisedWebSocketUrl}/ws?clientType=quest`,
      protocolVersion: config.protocolVersion,
      approvedQuestBuildId: config.approvedQuestBuildId,
    };
  }

  private serverConnectionView(): DashboardState["serverConnection"] {
    const host = this.advertisedHost.includes(":")
      ? `[${this.advertisedHost}]`
      : this.advertisedHost;
    return {
      bindHost: this.bindHost,
      port: this.serverPort,
      advertisedHttpUrl: `http://${host}:${this.serverPort}`,
      advertisedWebSocketUrl: `ws://${host}:${this.serverPort}`,
      approvedQuestBuildId: this.approvedQuestBuildId,
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  private updateConnectionPreflight(): void {
    const devices = this.watchdog.list();
    this.preflight.directorQuestConnected = devices.some(
      ({ connected, role }) => connected && role === "DIRECTOR",
    );
    this.preflight.builderQuestConnected = devices.some(
      ({ connected, role }) => connected && role === "BUILDER",
    );
  }

  private validateCalibrationReport(
    report: CalibrationReport,
    expectedAttemptId: string,
    expectedSimulation: boolean,
  ): CalibrationReport {
    const validated = structuredClone(report);
    const issues: string[] = [];
    if (validated.attemptId !== expectedAttemptId) {
      issues.push("ATTEMPT_ID_MISMATCH");
    }
    if (validated.tagSizeMeters !== APRILTAG_DETECTION_SIZE_METERS) {
      issues.push("TAG_SIZE_MISMATCH");
    }
    if (validated.simulation !== expectedSimulation) {
      issues.push("SIMULATION_IDENTITY_MISMATCH");
    }
    if (validated.rawFramesPersisted !== false) {
      issues.push("RAW_FRAME_PRIVACY_VIOLATION");
    }
    if (validated.status === "FAIL" && validated.failureReasons.length === 0) {
      issues.push("FAILED_WITHOUT_ACTIONABLE_REASON");
    }
    if (validated.status === "PASS") {
      if (validated.failureReasons.length > 0) {
        issues.push("PASS_REPORT_CONTAINS_FAILURE_REASON");
      }
      const samples = new Map(
        validated.tagSamples.map((sample) => [sample.tagId, sample]),
      );
      if (
        samples.size !== 6 ||
        ![1, 2, 3, 4, 5, 6].every((id) => samples.has(id))
      ) {
        issues.push("TAG_SAMPLE_SET_INVALID");
      }
      for (const id of [1, 2]) {
        if ((samples.get(id)?.acceptedCount ?? 0) < 5) {
          issues.push(`KEYBOARD_TAG_SAMPLES_INSUFFICIENT:id=${id}`);
        }
      }
      const usableTvTags = [3, 4, 5, 6].filter(
        (id) => (samples.get(id)?.acceptedCount ?? 0) >= 5,
      );
      if (usableTvTags.length < 3) {
        issues.push(`TV_TAGS_INSUFFICIENT:usable=${usableTvTags.length}`);
      }
      if (
        validated.keyboardSpacingMeters === null ||
        validated.keyboardSpacingResidualMeters === null ||
        validated.keyboardSpacingResidualMeters > 0.04
      ) {
        issues.push("KEYBOARD_SPACING_GATE_FAILED");
      }
      if (
        validated.keyboardRigInWorld === null ||
        validated.tvInKeyboardRig === null
      ) {
        issues.push("RIG_TRANSFORM_MISSING");
      }
    }

    if (issues.length > 0) {
      validated.status = "FAIL";
      validated.failureReasons = [
        ...validated.failureReasons,
        ...issues.map((issue) => `SERVER_VALIDATION:${issue}`),
      ];
    }
    return validated;
  }

  private compareCalibrationReports(): CalibrationComparisonView {
    const entries = [...this.calibrationReports.values()].sort((left, right) =>
      left.deviceId.localeCompare(right.deviceId),
    );
    const comparedDeviceIds = entries.map(({ deviceId }) => deviceId);
    if (entries.length !== 2) {
      return {
        status: "FAIL",
        comparedDeviceIds,
        tvPositionDifferenceMeters: null,
        tvRotationDifferenceDegrees: null,
        reason: "Both Quest calibration reports were not received.",
      };
    }
    if (entries.some(({ report }) => report.status !== "PASS")) {
      return {
        status: "FAIL",
        comparedDeviceIds,
        tvPositionDifferenceMeters: null,
        tvRotationDifferenceDegrees: null,
        reason: "At least one Quest failed its individual calibration quality gate.",
      };
    }
    if (entries.some(({ report }) => report.simulation)) {
      return {
        status: "DEFERRED",
        comparedDeviceIds,
        tvPositionDifferenceMeters: null,
        tvRotationDifferenceDegrees: null,
        reason:
          "One or more reports are simulated; repeat with two physical Quests before the Phase 5 exit gate.",
      };
    }

    const left = entries[0]!.report.tvInKeyboardRig;
    const right = entries[1]!.report.tvInKeyboardRig;
    if (left === null || right === null) {
      return {
        status: "FAIL",
        comparedDeviceIds,
        tvPositionDifferenceMeters: null,
        tvRotationDifferenceDegrees: null,
        reason: "A physical Quest report is missing its TV-to-keyboard transform.",
      };
    }
    const positionDifference = Math.hypot(
      left.position.x - right.position.x,
      left.position.y - right.position.y,
      left.position.z - right.position.z,
    );
    const rotationDifference = quaternionAngleDegrees(
      left.rotation,
      right.rotation,
    );
    const pass = positionDifference <= 0.05 && rotationDifference <= 5;
    return {
      status: pass ? "PASS" : "FAIL",
      comparedDeviceIds,
      tvPositionDifferenceMeters: positionDifference,
      tvRotationDifferenceDegrees: rotationDifference,
      reason: pass
        ? null
        : "The two physical Quests disagree beyond the provisional 0.05 m / 5 degree gate.",
    };
  }

  private validateDrStateReport(
    report: DiminishedRealityStateReport,
    requestedAction: DrPreviewCommandInput["action"],
    requestedTarget: DrPreviewCommandInput["target"],
  ): void {
    if (report.profileVersion !== DR_PROFILE_VERSION) {
      throw new Error(
        `Quest reported DR profile ${report.profileVersion}; expected ${DR_PROFILE_VERSION}.`,
      );
    }
    if (report.requestedAction !== requestedAction) {
      throw new Error("Quest DR report does not match the requested action.");
    }
    if (report.target !== requestedTarget && requestedAction !== "HIDE") {
      throw new Error("Quest DR report does not match the requested target.");
    }
    if (!report.drStateMatches) {
      throw new Error(
        report.reason ?? "Quest reported that its requested and actual DR states differ.",
      );
    }
    if (requestedAction === "SHOW" && !report.maskVisible) {
      throw new Error("Quest acknowledged SHOW without a visible DR mask.");
    }
    if (
      (requestedAction === "HIDE" || requestedAction === "REVEAL") &&
      report.geometryActive
    ) {
      throw new Error(`Quest acknowledged ${requestedAction} with active geometry.`);
    }
  }

  private questionnaireKey(
    completion: Pick<QuestionnaireCompletion, "kind" | "scopeId" | "participantId">,
  ): string {
    return `${completion.kind}:${completion.scopeId}:${completion.participantId}`;
  }

  private questionnaireGateView(): QuestionnaireGateView {
    const participantIds = this.sessionConfig?.deviceAssignments.map(
      ({ participantId }) => participantId,
    ) ?? [];
    let pending: QuestionnaireKind | null = null;
    let scopeId: string | null = null;
    if (this.questionnaireGateEnabled && this.schedule !== null) {
      if (this.laptopState === "SESSION_SETUP" && this.sessionConfig !== null) {
        pending = "PRE_STUDY";
        scopeId = this.sessionConfig.sessionId;
      } else if (this.laptopState === "POST_TRIAL") {
        const trial = this.currentTrial();
        if (
          trial !== null &&
          trial.kind !== "PRACTICE" &&
          (this.outcome === "COMPLETED" || this.outcome === "TIMEOUT")
        ) {
          pending = "POST_TRIAL";
          scopeId = trial.trialId;
        }
      } else if (this.laptopState === "CONDITION_REVIEW") {
        const previous = this.schedule.trials[this.currentTrialIndex - 1];
        if (previous?.blockIndex !== null && previous?.blockIndex !== undefined) {
          pending = "POST_CONDITION";
          scopeId = `BLOCK-${previous.blockIndex}`;
        }
      } else if (
        this.laptopState === "SESSION_COMPLETE" &&
        this.outcome !== "PARTICIPANT_WITHDRAWAL" &&
        this.outcome !== "EXPERIMENTER_ABORTED" &&
        this.sessionConfig !== null
      ) {
        pending = "POST_SESSION";
        scopeId = this.sessionConfig.sessionId;
      }
    }
    const completedParticipantIds = pending === null || scopeId === null
      ? []
      : participantIds.filter((participantId) =>
          this.questionnaireCompletions.has(
            this.questionnaireKey({ kind: pending!, scopeId: scopeId!, participantId }),
          ),
        );
    return {
      required: this.questionnaireGateEnabled,
      pending,
      scopeId,
      participantIds,
      completedParticipantIds,
      formUrl: pending === null ? null : this.questionnaireUrls[pending] ?? null,
    };
  }

  private requireQuestionnaireGateComplete(): void {
    const gate = this.questionnaireGateView();
    if (
      gate.pending !== null &&
      gate.completedParticipantIds.length !== gate.participantIds.length
    ) {
      const missing = gate.participantIds.filter(
        (participantId) => !gate.completedParticipantIds.includes(participantId),
      );
      throw new Error(
        `${gate.pending} questionnaire completion is missing for ${missing.join(", ")}.`,
      );
    }
  }

  private availableActions(): string[] {
    if (this.sessionConfig === null) {
      return ["CREATE_SESSION"];
    }
    if (this.sessionClosed) {
      return ["VALIDATE_EXPORT"];
    }
    const actions = ["START_SIMULATORS", "STOP_SIMULATORS"];
    if (
      this.interruptedRecordingTrialId !== null &&
      ["RECOVERY_REQUIRED", "POST_TRIAL", "BLOCKED"].includes(this.laptopState)
    ) {
      actions.push("RECOVER_MEDIA");
    }
    if (this.drPreviewEnabled && this.laptopState === "CALIBRATION") {
      actions.push("DR_PREVIEW");
    }
    switch (this.laptopState) {
      case "SESSION_SETUP":
      case "BLOCKED":
        actions.push("BEGIN_PREFLIGHT");
        if (this.questionnaireGateView().pending !== null) {
          actions.push("RECORD_QUESTIONNAIRE_COMPLETION");
        }
        break;
      case "PREFLIGHT":
        actions.push("SET_PREFLIGHT", "CONFIRM_PREFLIGHT");
        break;
      case "CALIBRATION":
        actions.push(
          "START_CALIBRATION",
          "SIMULATE_CALIBRATION",
          "OVERRIDE_CALIBRATION",
          "PREPARE_TRIAL",
        );
        break;
      case "TRIAL_PREPARED":
        actions.push("START_TRIAL");
        break;
      case "TRIAL_ACTIVE":
        if (this.liveReconnects.size === 0) {
          actions.push("RECORD_SUBMISSION");
          if (this.timer.view().limitReached) {
            actions.push("END_TIME_LIMIT");
          }
        } else if (
          [...this.liveReconnects.values()].some(
            ({ phase }) => phase === "AWAITING_EXPERIMENTER_CONFIRMATION",
          )
        ) {
          actions.push("CONFIRM_RECONNECT_CONTINUATION");
        }
        actions.push("INVALIDATE_TRIAL", "ABORT_TRIAL");
        break;
      case "POST_TRIAL":
        actions.push("COMPLETE_POST_TRIAL");
        if (this.questionnaireGateView().pending !== null) {
          actions.push("RECORD_QUESTIONNAIRE_COMPLETION");
        }
        break;
      case "CONDITION_REVIEW":
        actions.push("COMPLETE_CONDITION_REVIEW");
        if (this.questionnaireGateEnabled) {
          actions.push("RECORD_QUESTIONNAIRE_COMPLETION");
        } else {
          actions.push("BEGIN_PREFLIGHT");
        }
        break;
      case "RECOVERY_REQUIRED":
        actions.push("RESOLVE_RECOVERY");
        break;
      case "SESSION_COMPLETE":
        actions.push("VALIDATE_EXPORT", "CLOSE_SESSION");
        if (this.questionnaireGateView().pending !== null) {
          actions.push("RECORD_QUESTIONNAIRE_COMPLETION");
        }
        if (this.exportValidation?.valid === true) {
          actions.push("CLEANUP_QUEST_LOCAL_LOGS");
        }
        break;
      default:
        break;
    }
    return actions;
  }

  private currentTrial(): TrialDefinition | null {
    return this.schedule?.trials[this.currentTrialIndex] ?? null;
  }

  private requireCurrentTrial(): TrialDefinition {
    const trial = this.currentTrial();
    if (trial === null) {
      throw new Error("No scheduled trial is available.");
    }
    return trial;
  }

  private requireGuard(
    input: GuardedActionInput,
    reasonRequired: boolean,
  ): void {
    if (!input.confirmed) {
      throw new Error("Guarded action was not confirmed.");
    }
    if (reasonRequired && (input.reason?.trim().length ?? 0) === 0) {
      throw new Error("A reason is required for this guarded action.");
    }
  }

  private requireNoLiveReconnect(): void {
    if (this.liveReconnects.size > 0) {
      throw new Error(
        "A Quest reconnect must be validated and confirmed before continuing the trial.",
      );
    }
  }

  private publish(): void {
    this.onStateChanged?.(this.getDashboardState());
  }

  private requireConfig(): SessionConfig {
    if (this.sessionConfig === null) {
      throw new Error("No active session configuration.");
    }
    return this.sessionConfig;
  }

  private requireSchedule(): Schedule {
    if (this.schedule === null) {
      throw new Error("No active schedule.");
    }
    return this.schedule;
  }

  private requireAllocation(): CounterbalanceAllocation {
    if (this.allocation === null) {
      throw new Error("No active counterbalance allocation.");
    }
    return this.allocation;
  }

  private requireLogger(): EventLogger {
    if (this.eventLogger === null) {
      throw new Error("No active event logger.");
    }
    return this.eventLogger;
  }

  private requireSnapshotManager(): SnapshotManager {
    if (this.snapshotManager === null) {
      throw new Error("No active snapshot manager.");
    }
    return this.snapshotManager;
  }

  private requireSessionDirectory(): string {
    if (this.sessionDirectory === null) {
      throw new Error("No active session directory.");
    }
    return this.sessionDirectory;
  }
}
