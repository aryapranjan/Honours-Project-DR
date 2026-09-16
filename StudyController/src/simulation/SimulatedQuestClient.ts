import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import WebSocket from "ws";

import { sha256CanonicalJson } from "../canonicalJson.js";
import {
  DR_PROFILE_VERSION,
  PROTOCOL_VERSION,
  type DiminishedRealityStateReport,
  type DistractorType,
  type MessageEnvelope,
  type QuestState,
} from "../contracts.js";
import { assertSchema, SCHEMA_IDS } from "../validation.js";
import { createDeterministicCalibrationReport } from "./simulatedCalibrationReport.js";

export class SimulatedQuestClient {
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private questState: QuestState = "BOOTING";
  private lastAppliedStateVersion = 0;
  private heartbeatSequence = 0;
  private sessionId: string | null = null;
  private localLogRetained = true;
  private drTarget: DistractorType | null = null;
  private drRequestedEnabled = false;
  private drPrepared = false;
  private drVisible = false;
  private drDebugBounds = false;
  private drCalibrationAttemptId: string | null = null;

  public constructor(
    private readonly baseUrl: string,
    public readonly deviceId: string,
    private readonly accessToken: string,
    private readonly appBuildId: string,
  ) {}

  public connect(): Promise<void> {
    if (this.socket !== null) {
      throw new Error(`${this.deviceId} simulator is already connected.`);
    }

    return new Promise((resolve, reject) => {
      const url = new URL("/ws", this.baseUrl);
      url.searchParams.set("clientType", "quest");
      const socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      this.socket = socket;

      socket.once("open", () => {
        this.questState = "SYNCHRONIZING";
        this.heartbeat = setInterval(() => this.sendHeartbeat(), 500);
        resolve();
      });
      socket.once("error", reject);
      socket.on("message", (data) => {
        this.handleMessage(data.toString());
      });
      socket.on("close", () => {
        if (this.heartbeat !== null) {
          clearInterval(this.heartbeat);
          this.heartbeat = null;
        }
        this.socket = null;
        this.questState = "FAULTED";
      });
    });
  }

  public stop(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.socket?.close(1000, "Simulator stopped.");
    this.socket = null;
  }

  public disconnectFor(durationMs: number): void {
    this.stop();
    setTimeout(() => {
      void this.connect();
    }, durationMs);
  }

  private handleMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as MessageEnvelope;
    assertSchema(SCHEMA_IDS.message, message);
    this.sessionId = message.sessionId;
    this.lastAppliedStateVersion = Math.max(
      this.lastAppliedStateVersion,
      message.stateVersion,
    );

    switch (message.type) {
      case "STATE_SNAPSHOT":
        {
          const wrapper = message.payload as {
            snapshot: Record<string, unknown>;
            snapshotHash: string;
          };
          if (sha256CanonicalJson(wrapper.snapshot) !== wrapper.snapshotHash) {
            this.socket?.close(1008, "Snapshot hash mismatch.");
            break;
          }
          this.applyDrSnapshot(wrapper.snapshot);
          this.questState = this.stateFromSnapshot(
            wrapper.snapshot.laptopState as string,
          );
          this.reply(message, "STATE_SNAPSHOT_APPLIED", {
            appliedStateVersion: message.stateVersion,
            snapshotHash: wrapper.snapshotHash,
            drState: this.drState("SNAPSHOT"),
          });
          this.sendHeartbeat();
          break;
        }
      case "PREPARE_TRIAL":
        this.drTarget = message.payload.drTarget as DistractorType;
        this.drRequestedEnabled = message.payload.drEnabled === true;
        this.drPrepared = true;
        this.drVisible = false;
        this.drDebugBounds = false;
        this.questState = "TRIAL_PREPARED";
        this.reply(message, "READY", {
          readiness: "READY",
          calibrationStatus: message.payload.calibrationStatus,
          calibrationOverrideReason: message.payload.calibrationOverrideReason,
          drStateMatches: true,
          drState: this.drState("PREPARE"),
          appVersion: this.appBuildId,
          deviceStatus: "SIMULATED_READY",
          reasons: [],
        });
        break;
      case "BEGIN_CALIBRATION":
        {
          this.questState = "CALIBRATING";
          this.drCalibrationAttemptId = String(message.payload.attemptId);
          this.questState = "READY";
          this.reply(message, "CALIBRATION_REPORT", {
            ...createDeterministicCalibrationReport(
              String(message.payload.attemptId),
              true,
            ),
          });
          this.sendHeartbeat();
          break;
        }
      case "CONTINUE_AFTER_RECOVERY":
        this.questState = "TRIAL_ACTIVE";
        this.reply(message, "CONTINUED", {
          appliedStateVersion: message.payload.snapshotStateVersion,
          snapshotHash: message.payload.snapshotHash,
        });
        break;
      case "REQUEST_LOCAL_LOG_STATUS":
        this.reply(message, "LOCAL_LOG_STATUS", {
          sessionId: message.sessionId,
          retained: this.localLogRetained,
          recordCount: this.localLogRetained ? 1 : 0,
          sha256: this.localLogRetained
            ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : null,
        });
        break;
      case "CLEANUP_LOCAL_LOG":
        this.localLogRetained = false;
        this.reply(message, "LOCAL_LOG_CLEANED", {
          sessionId: message.sessionId,
          deleted: true,
        });
        break;
      case "HEARTBEAT_ACK":
        break;
      case "COMMIT_START":
        this.drVisible = this.drRequestedEnabled && this.drPrepared;
        this.drDebugBounds = false;
        this.questState = "TRIAL_ACTIVE";
        this.reply(message, "STARTED", {
          appliedStateVersion: message.stateVersion,
          drState: this.drState("SHOW"),
        });
        break;
      case "STOP_TRIAL":
        this.drRequestedEnabled = false;
        this.drPrepared = false;
        this.drVisible = false;
        this.drDebugBounds = false;
        this.questState = "READY";
        this.reply(message, "STOPPED", {
          outcome: message.payload.outcome,
          appliedStateVersion: message.stateVersion,
          drState: this.drState("HIDE"),
        });
        break;
      case "DR_PREVIEW":
        this.applyDrPreview(message);
        break;
      default:
        break;
    }
  }

  private sendHeartbeat(): void {
    if (
      this.socket === null ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.sessionId === null
    ) {
      return;
    }
    this.heartbeatSequence += 1;
    const message: MessageEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      trialId: null,
      commandId: randomUUID(),
      stateVersion: this.lastAppliedStateVersion,
      sender: this.deviceId,
      target: "SERVER",
      timestampUtc: new Date().toISOString(),
      timestampMonotonicMs: performance.now(),
      type: "HEARTBEAT",
      payload: {
        sequence: this.heartbeatSequence,
        questState: this.questState,
        lastAppliedStateVersion: this.lastAppliedStateVersion,
      },
    };
    assertSchema(SCHEMA_IDS.message, message);
    this.socket.send(JSON.stringify(message));
  }

  private applyDrPreview(message: MessageEnvelope): void {
    const action = String(message.payload.action);
    const target = message.payload.target as DistractorType;
    switch (action) {
      case "PREPARE":
        this.drTarget = target;
        this.drRequestedEnabled = true;
        this.drPrepared = true;
        this.drVisible = false;
        this.drDebugBounds = false;
        break;
      case "SHOW":
        this.drVisible = this.drPrepared && this.drRequestedEnabled;
        break;
      case "HIDE":
        this.drRequestedEnabled = false;
        this.drPrepared = false;
        this.drVisible = false;
        this.drDebugBounds = false;
        break;
      case "REVEAL":
        this.drVisible = false;
        break;
      case "SET_DEBUG_BOUNDS":
        this.drDebugBounds = message.payload.debugBounds === true;
        break;
      case "REPORT":
        break;
      default:
        this.socket?.close(1008, "Unsupported DR preview action.");
        return;
    }
    this.reply(message, "DR_STATE_REPORT", { ...this.drState(action) });
  }

  private applyDrSnapshot(snapshot: Record<string, unknown>): void {
    const laptopState = String(snapshot.laptopState ?? "");
    const currentTrial = snapshot.currentTrial as
      | { distractorType?: DistractorType }
      | null;
    const trialState =
      laptopState === "TRIAL_PREPARED" ||
      laptopState === "TRIAL_COMMITTED" ||
      laptopState === "TRIAL_ACTIVE";
    if (!trialState || snapshot.failSafeRequired === true) {
      this.drRequestedEnabled = false;
      this.drPrepared = false;
      this.drVisible = false;
      this.drDebugBounds = false;
      return;
    }
    this.drTarget =
      (snapshot.drTarget as DistractorType | undefined) ??
      currentTrial?.distractorType ??
      null;
    this.drRequestedEnabled = snapshot.drEnabled === true;
    this.drPrepared = true;
    this.drVisible =
      laptopState === "TRIAL_ACTIVE" && this.drRequestedEnabled;
    this.drDebugBounds = false;
  }

  private drState(action: string): DiminishedRealityStateReport {
    const actualState = this.drVisible
      ? "VISIBLE"
      : this.drPrepared
        ? this.drRequestedEnabled
          ? action === "REVEAL"
            ? "REVEALED"
            : "PREPARED"
          : "NO_DR"
        : "HIDDEN";
    return {
      requestedAction: action,
      target: this.drTarget,
      profileVersion: DR_PROFILE_VERSION,
      requestedEnabled: this.drRequestedEnabled,
      actualState,
      prepared: this.drPrepared,
      maskVisible: this.drVisible,
      debugBoundsVisible: this.drDebugBounds,
      geometryActive: this.drVisible,
      calibrationAttemptId: this.drCalibrationAttemptId,
      calibrationStatus:
        this.drCalibrationAttemptId === null ? "NOT_RUN" : "PASS",
      drStateMatches: true,
      measuredFps: this.drVisible ? 72 : null,
      performanceTargetFps: 72,
      performanceGateEvaluated: this.drVisible,
      performanceGatePass: this.drVisible ? true : null,
      reason: null,
    };
  }

  private reply(
    request: MessageEnvelope,
    type: MessageEnvelope["type"],
    payload: Record<string, unknown>,
  ): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message: MessageEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: request.sessionId,
      trialId: request.trialId,
      commandId: request.commandId,
      stateVersion: request.stateVersion,
      sender: this.deviceId,
      target: "SERVER",
      timestampUtc: new Date().toISOString(),
      timestampMonotonicMs: performance.now(),
      type,
      payload,
    };
    assertSchema(SCHEMA_IDS.message, message);
    this.socket.send(JSON.stringify(message));
  }

  private stateFromSnapshot(laptopState: string): QuestState {
    switch (laptopState) {
      case "TRIAL_PREPARED":
        return "TRIAL_PREPARED";
      case "TRIAL_COMMITTED":
        return "TRIAL_COMMITTED";
      case "TRIAL_ACTIVE":
        return "RECOVERING";
      case "TRIAL_STOPPING":
        return "STOPPING";
      case "RECOVERY_REQUIRED":
        return "RECOVERING";
      default:
        return "IDLE";
    }
  }
}
