import { createHash, randomUUID } from "node:crypto";

import WebSocket from "ws";

import { sha256CanonicalJson } from "../canonicalJson.js";
import type { Clock } from "../clock.js";
import { isoNow, systemClock } from "../clock.js";
import {
  APRILTAG_DETECTION_SIZE_METERS,
  CALIBRATION_THRESHOLD_PROFILE,
  DR_PROFILE_VERSION,
  PROTOCOL_VERSION,
  TRIAL_TIME_LIMIT_SECONDS,
  type CalibrationReport,
  type CalibrationStatus,
  type LocalLogStatus,
  type MessageEnvelope,
  type MessageType,
  type QuestDeviceId,
  type SessionConfig,
  type TrialDefinition,
  type TrialOutcome,
  type DiminishedRealityStateReport,
} from "../contracts.js";
import type { DrPreviewCommandInput } from "../runtimeTypes.js";
import { areProtocolVersionsCompatible } from "../protocolRules.js";
import { assertSchema, SCHEMA_IDS } from "../validation.js";
import type { ConnectionObservation, ConnectionWatchdog } from "./ConnectionWatchdog.js";
import type { EnrollmentIdentity } from "./EnrollmentManager.js";
import type { EventLogger } from "./EventLogger.js";

interface PendingCommand {
  deviceId: QuestDeviceId;
  expectedType: MessageType;
  resolve: (message: MessageEnvelope) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface CoordinatorContext {
  sessionConfig: SessionConfig;
  getStateVersion: () => number;
  getTrialId: () => string | null;
  getStateSnapshot: (deviceId: QuestDeviceId) => Record<string, unknown>;
  eventLogger: EventLogger;
}

export interface SnapshotAppliedResult {
  appliedStateVersion: number;
  snapshotHash: string;
}

export interface TrialCalibrationGate {
  status: Extract<CalibrationStatus, "PASS" | "OVERRIDDEN">;
  overrideReason: string | null;
}

export interface CoordinatorCallbacks {
  onMessage?: (message: MessageEnvelope) => void | Promise<void>;
  onFault?: (
    deviceId: QuestDeviceId,
    payload: Record<string, unknown>,
  ) => void | Promise<void>;
  onConnectionRegistered?: (
    deviceId: QuestDeviceId,
    observation: ConnectionObservation,
  ) => void | Promise<void>;
  onSnapshotApplied?: (
    deviceId: QuestDeviceId,
    observation: ConnectionObservation,
    result: SnapshotAppliedResult,
  ) => void | Promise<void>;
  onLocalLogStatus?: (
    deviceId: QuestDeviceId,
    status: LocalLogStatus,
  ) => void | Promise<void>;
}

export class CommandCoordinator {
  private readonly sockets = new Map<QuestDeviceId, WebSocket>();
  private readonly pending = new Map<string, PendingCommand>();
  private context: CoordinatorContext | null = null;

  public constructor(
    private readonly watchdog: ConnectionWatchdog,
    private readonly callbacks: CoordinatorCallbacks = {},
    private readonly clock: Clock = systemClock,
  ) {}

  public configure(context: CoordinatorContext): void {
    this.context = context;
  }

  public async registerSocket(
    identity: EnrollmentIdentity,
    socket: WebSocket,
  ): Promise<void> {
    const context = this.requireContext();
    const assignment = context.sessionConfig.deviceAssignments.find(
      (candidate) => candidate.deviceId === identity.deviceId,
    );
    if (
      assignment === undefined ||
      assignment.participantId !== identity.participantId ||
      assignment.role !== identity.role
    ) {
      socket.close(1008, "Enrollment does not match this session.");
      throw new Error(`${identity.deviceId} enrollment does not match the session.`);
    }
    if (
      !areProtocolVersionsCompatible(
        context.sessionConfig.protocolVersion,
        identity.protocolVersion,
      )
    ) {
      socket.close(1008, "Incompatible protocol version.");
      throw new Error(`Incompatible protocol version ${identity.protocolVersion}.`);
    }
    if (identity.appBuildId !== context.sessionConfig.approvedQuestBuildId) {
      socket.close(1008, "Unapproved Quest build.");
      throw new Error(`Unapproved Quest build ${identity.appBuildId}.`);
    }

    const prior = this.sockets.get(identity.deviceId);
    if (prior !== undefined && prior.readyState === WebSocket.OPEN) {
      prior.close(1012, "Replaced by authenticated reconnect.");
    }
    this.sockets.set(identity.deviceId, socket);
    const observation = this.watchdog.connected(
      identity.deviceId,
      identity.simulation,
    );

    await context.eventLogger.append({
      trialId: context.getTrialId(),
      stateVersion: context.getStateVersion(),
      source: "SERVER",
      eventType: "DEVICE_CONNECTED",
      payload: {
        deviceId: identity.deviceId,
        simulation: identity.simulation,
        protocolVersion: identity.protocolVersion,
        appBuildId: identity.appBuildId,
      },
    });

    socket.on("message", (data) => {
      void this.handleMessage(identity.deviceId, data.toString()).catch(() => {
        socket.close(1008, "Invalid protocol message.");
      });
    });
    socket.on("close", () => {
      if (this.sockets.get(identity.deviceId) === socket) {
        this.sockets.delete(identity.deviceId);
        this.rejectPendingForDevice(
          identity.deviceId,
          new Error(`${identity.deviceId} disconnected.`),
        );
        this.watchdog.disconnected(identity.deviceId);
        void context.eventLogger.append({
          trialId: context.getTrialId(),
          stateVersion: context.getStateVersion(),
          source: "SERVER",
          eventType: "DEVICE_DISCONNECTED",
          payload: { deviceId: identity.deviceId },
        });
      }
    });
    socket.on("error", () => {
      if (this.sockets.get(identity.deviceId) === socket) {
        this.watchdog.disconnected(
          identity.deviceId,
          "Quest WebSocket error.",
        );
      }
    });

    await this.synchronizeConnection(identity.deviceId, observation);
  }

  public async prepareTrial(
    trial: TrialDefinition,
    calibrationByDevice: Record<QuestDeviceId, TrialCalibrationGate>,
  ): Promise<MessageEnvelope[]> {
    const context = this.requireContext();
    const configurationHash = createHash("sha256")
      .update(JSON.stringify(trial))
      .digest("hex");
    return this.sendToAllAndAwait(
      "PREPARE_TRIAL",
      "READY",
      trial.trialId,
      (deviceId) => {
        const assignment = context.sessionConfig.deviceAssignments.find(
          (candidate) => candidate.deviceId === deviceId,
        )!;
        const drEnabled =
          trial.condition === "SYMMETRIC_DR" ||
          (trial.condition === "ASYMMETRIC_DR" &&
            assignment.role === context.sessionConfig.asymmetricRecipient);
        return {
          role: assignment.role,
          condition: trial.condition,
          distractorType: trial.distractorType,
          puzzleId: trial.puzzleId,
          drEnabled,
          drTarget: trial.distractorType,
          drProfileVersion: DR_PROFILE_VERSION,
          trialDurationSeconds: TRIAL_TIME_LIMIT_SECONDS,
          configurationHash,
          calibrationStatus: calibrationByDevice[deviceId].status,
          calibrationOverrideReason:
            calibrationByDevice[deviceId].overrideReason,
        };
      },
    );
  }

  public async runCalibration(
    attemptId: string,
  ): Promise<Array<{ deviceId: QuestDeviceId; report: CalibrationReport }>> {
    const responses = await this.sendToAllAndAwait(
      "BEGIN_CALIBRATION",
      "CALIBRATION_REPORT",
      this.requireContext().getTrialId(),
      () => ({
        attemptId,
        durationMs: 6_000,
        tagFamily: "tagStandard41h12",
        tagSizeMeters: APRILTAG_DETECTION_SIZE_METERS,
        requiredTagIds: [1, 2, 3, 4, 5, 6],
        minimumVisibleTvTags: 3,
        thresholdProfile: CALIBRATION_THRESHOLD_PROFILE,
      }),
      12_000,
    );
    return responses.map((message) => ({
      deviceId: message.sender as QuestDeviceId,
      report: message.payload as unknown as CalibrationReport,
    }));
  }

  public async previewDiminishedReality(
    input: DrPreviewCommandInput,
  ): Promise<Array<{ deviceId: QuestDeviceId; report: DiminishedRealityStateReport }>> {
    const responses = await this.sendToAllAndAwait(
      "DR_PREVIEW",
      "DR_STATE_REPORT",
      this.requireContext().getTrialId(),
      () => ({
        action: input.action,
        target: input.target,
        profileVersion: DR_PROFILE_VERSION,
        debugBounds:
          input.action === "SET_DEBUG_BOUNDS"
            ? input.debugBounds === true
            : null,
      }),
    );
    return responses.map((message) => ({
      deviceId: message.sender as QuestDeviceId,
      report: message.payload as unknown as DiminishedRealityStateReport,
    }));
  }

  public commitStart(
    trialId: string,
    startAtUtc: string,
    startAtMonotonicMs: number,
  ): Promise<MessageEnvelope[]> {
    return this.sendToAllAndAwait(
      "COMMIT_START",
      "STARTED",
      trialId,
      () => ({ startAtUtc, startAtMonotonicMs }),
    );
  }

  public stopTrial(
    trialId: string,
    outcome: TrialOutcome,
  ): Promise<MessageEnvelope[]> {
    return this.sendToAllAndAwait(
      "STOP_TRIAL",
      "STOPPED",
      trialId,
      () => ({ outcome }),
    );
  }

  public async continueAfterRecovery(
    deviceId: QuestDeviceId,
    snapshotStateVersion: number,
    snapshotHash: string,
  ): Promise<void> {
    const response = await this.sendAndAwait(
      deviceId,
      "CONTINUE_AFTER_RECOVERY",
      "CONTINUED",
      this.requireContext().getTrialId(),
      { snapshotStateVersion, snapshotHash },
      5_000,
    );
    const payload = response.payload as unknown as SnapshotAppliedResult;
    if (
      payload.appliedStateVersion !== snapshotStateVersion ||
      payload.snapshotHash !== snapshotHash
    ) {
      throw new Error(`${deviceId} continued from an unexpected snapshot.`);
    }
  }

  public async requestLocalLogStatus(
    deviceId: QuestDeviceId,
  ): Promise<LocalLogStatus> {
    const context = this.requireContext();
    const response = await this.sendAndAwait(
      deviceId,
      "REQUEST_LOCAL_LOG_STATUS",
      "LOCAL_LOG_STATUS",
      null,
      { sessionId: context.sessionConfig.sessionId },
      5_000,
    );
    return response.payload as unknown as LocalLogStatus;
  }

  public async cleanupLocalLog(
    deviceId: QuestDeviceId,
    expectedSha256: string | null,
  ): Promise<void> {
    const context = this.requireContext();
    const response = await this.sendAndAwait(
      deviceId,
      "CLEANUP_LOCAL_LOG",
      "LOCAL_LOG_CLEANED",
      null,
      {
        sessionId: context.sessionConfig.sessionId,
        expectedSha256,
      },
      5_000,
    );
    const payload = response.payload as {
      sessionId: string;
      deleted: boolean;
    };
    if (
      payload.sessionId !== context.sessionConfig.sessionId ||
      payload.deleted !== true
    ) {
      throw new Error(`${deviceId} did not confirm local-log cleanup.`);
    }
  }

  public closeAll(): void {
    for (const socket of this.sockets.values()) {
      socket.close(1001, "Server shutting down.");
    }
    this.sockets.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Command coordinator closed."));
    }
    this.pending.clear();
  }

  private async synchronizeConnection(
    deviceId: QuestDeviceId,
    observation: ConnectionObservation,
  ): Promise<void> {
    await this.callbacks.onConnectionRegistered?.(deviceId, observation);
    const result = await this.sendStateSnapshotAndAwait(deviceId);
    await this.callbacks.onSnapshotApplied?.(deviceId, observation, result);
  }

  private async sendStateSnapshotAndAwait(
    deviceId: QuestDeviceId,
  ): Promise<SnapshotAppliedResult> {
    const context = this.requireContext();
    const snapshot = context.getStateSnapshot(deviceId);
    const snapshotHash = sha256CanonicalJson(snapshot);
    const stateVersion = context.getStateVersion();
    const response = await this.sendAndAwait(
      deviceId,
      "STATE_SNAPSHOT",
      "STATE_SNAPSHOT_APPLIED",
      context.getTrialId(),
      { snapshot, snapshotHash },
      5_000,
    );
    const result = response.payload as unknown as SnapshotAppliedResult;
    if (
      result.appliedStateVersion !== stateVersion ||
      result.snapshotHash !== snapshotHash
    ) {
      throw new Error(`${deviceId} acknowledged an unexpected state snapshot.`);
    }
    return result;
  }

  private async sendToAllAndAwait(
    type: MessageType,
    expectedType: MessageType,
    trialId: string | null,
    payloadFactory: (deviceId: QuestDeviceId) => Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<MessageEnvelope[]> {
    const context = this.requireContext();
    return Promise.all(
      context.sessionConfig.deviceAssignments.map(({ deviceId }) =>
        this.sendAndAwait(
          deviceId,
          type,
          expectedType,
          trialId,
          payloadFactory(deviceId),
          timeoutMs,
        ),
      ),
    );
  }

  private async sendAndAwait(
    deviceId: QuestDeviceId,
    type: MessageType,
    expectedType: MessageType,
    trialId: string | null,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<MessageEnvelope> {
    const context = this.requireContext();
    const socket = this.sockets.get(deviceId);
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${deviceId} is not connected.`);
    }

    const message = this.createEnvelope(deviceId, type, trialId, payload);
    assertSchema(SCHEMA_IDS.message, message);
    await context.eventLogger.append({
      trialId,
      stateVersion: context.getStateVersion(),
      source: "SERVER",
      eventType: "COMMAND_SENT",
      payload: {
        commandId: message.commandId,
        target: deviceId,
        type,
      },
    });

    return new Promise<MessageEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.commandId);
        reject(
          new Error(
            `${deviceId} did not acknowledge ${type} with ${expectedType}.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(message.commandId, {
        deviceId,
        expectedType,
        resolve,
        reject,
        timeout,
      });
      socket.send(JSON.stringify(message));
    });
  }

  private async handleMessage(
    deviceId: QuestDeviceId,
    rawMessage: string,
  ): Promise<void> {
    const context = this.requireContext();
    const message = JSON.parse(rawMessage) as MessageEnvelope;
    assertSchema(SCHEMA_IDS.message, message);
    if (
      message.sender !== deviceId ||
      message.target !== "SERVER" ||
      message.sessionId !== context.sessionConfig.sessionId
    ) {
      throw new Error("Quest message envelope does not match its connection.");
    }
    if (
      !areProtocolVersionsCompatible(
        context.sessionConfig.protocolVersion,
        message.protocolVersion,
      )
    ) {
      throw new Error("Quest message uses an incompatible protocol version.");
    }

    if (message.type === "HEARTBEAT") {
      const receivedAtMonotonicMs = this.clock.monotonicNow();
      const payload = message.payload as {
        sequence: number;
        questState: Parameters<ConnectionWatchdog["heartbeat"]>[1];
        lastAppliedStateVersion: number;
      };
      const observation = this.watchdog.heartbeat(
        deviceId,
        payload.questState,
        payload.lastAppliedStateVersion,
      );
      this.sendReply(deviceId, message, "HEARTBEAT_ACK", {
        sequence: payload.sequence,
        serverReceiveMonotonicMs: receivedAtMonotonicMs,
      });
      if (observation.reconnectDurationMs !== null) {
        await this.synchronizeConnection(deviceId, observation);
      }
      return;
    }

    await context.eventLogger.append({
      trialId: message.trialId,
      stateVersion: context.getStateVersion(),
      source: deviceId,
      eventType: "MESSAGE_RECEIVED",
      payload: {
        commandId: message.commandId,
        type: message.type,
      },
    });

    if (message.type === "FAULT") {
      await this.callbacks.onFault?.(deviceId, message.payload);
    } else {
      if (message.type === "LOCAL_LOG_STATUS") {
        await this.callbacks.onLocalLogStatus?.(
          deviceId,
          message.payload as unknown as LocalLogStatus,
        );
      }
      const pending = this.pending.get(message.commandId);
      if (
        pending !== undefined &&
        pending.deviceId === deviceId &&
        pending.expectedType === message.type
      ) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.commandId);
        const payload = message.payload as Record<string, unknown>;
        const appliedVersion =
          typeof payload.appliedStateVersion === "number"
            ? payload.appliedStateVersion
            : message.stateVersion;
        if (message.type === "READY") {
          if (payload.readiness !== "READY") {
            throw new Error(
              `${deviceId} refused trial preparation: ${JSON.stringify(payload.reasons ?? [])}`,
            );
          }
          if (payload.appVersion !== context.sessionConfig.approvedQuestBuildId) {
            throw new Error(`${deviceId} READY reported an unapproved build.`);
          }
          if (payload.drStateMatches !== true) {
            throw new Error(`${deviceId} READY reported a mismatched DR state.`);
          }
          this.watchdog.setCalibration(
            deviceId,
            payload.calibrationStatus as Parameters<
              ConnectionWatchdog["setCalibration"]
            >[1],
          );
          this.watchdog.setState(deviceId, "TRIAL_PREPARED", appliedVersion);
        } else if (message.type === "STARTED") {
          this.watchdog.setState(deviceId, "TRIAL_ACTIVE", appliedVersion);
        } else if (message.type === "STOPPED") {
          this.watchdog.setState(deviceId, "READY", appliedVersion);
        }
        if (payload.drState !== undefined) {
          await context.eventLogger.append({
            trialId: message.trialId,
            stateVersion: context.getStateVersion(),
            source: deviceId,
            eventType: "DR_STATE_REPORTED",
            payload: payload.drState as Record<string, unknown>,
          });
        } else if (message.type === "DR_STATE_REPORT") {
          await context.eventLogger.append({
            trialId: message.trialId,
            stateVersion: context.getStateVersion(),
            source: deviceId,
            eventType: "DR_STATE_REPORTED",
            payload,
          });
        }
        pending.resolve(message);
      }
    }

    await this.callbacks.onMessage?.(message);
  }

  private sendReply(
    deviceId: QuestDeviceId,
    request: MessageEnvelope,
    type: MessageType,
    payload: Record<string, unknown>,
  ): void {
    const socket = this.sockets.get(deviceId);
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const response: MessageEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: request.sessionId,
      trialId: request.trialId,
      commandId: request.commandId,
      stateVersion: this.requireContext().getStateVersion(),
      sender: "SERVER",
      target: deviceId,
      timestampUtc: isoNow(this.clock),
      timestampMonotonicMs: this.clock.monotonicNow(),
      type,
      payload,
    };
    assertSchema(SCHEMA_IDS.message, response);
    socket.send(JSON.stringify(response));
  }

  private createEnvelope(
    deviceId: QuestDeviceId,
    type: MessageType,
    trialId: string | null,
    payload: Record<string, unknown>,
  ): MessageEnvelope {
    const context = this.requireContext();
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: context.sessionConfig.sessionId,
      trialId,
      commandId: randomUUID(),
      stateVersion: context.getStateVersion(),
      sender: "SERVER",
      target: deviceId,
      timestampUtc: isoNow(this.clock),
      timestampMonotonicMs: this.clock.monotonicNow(),
      type,
      payload,
    };
  }

  private rejectPendingForDevice(deviceId: QuestDeviceId, error: Error): void {
    for (const [commandId, pending] of this.pending) {
      if (pending.deviceId === deviceId) {
        clearTimeout(pending.timeout);
        pending.reject(error);
        this.pending.delete(commandId);
      }
    }
  }

  private requireContext(): CoordinatorContext {
    if (this.context === null) {
      throw new Error("Command coordinator has no active session.");
    }
    return this.context;
  }
}
