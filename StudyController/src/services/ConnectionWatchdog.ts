import type { Clock } from "../clock.js";
import { isoNow, systemClock } from "../clock.js";
import {
  CRITICAL_FAULT_GRACE_MS,
  type CalibrationStatus,
  type DeviceAssignment,
  type QuestDeviceId,
  type QuestState,
} from "../contracts.js";
import type { DeviceRuntimeStatus } from "../runtimeTypes.js";

interface InternalStatus extends DeviceRuntimeStatus {
  lastHeartbeatMonotonicMs: number | null;
  faultStartedMonotonicMs: number | null;
  criticalTimeoutNotified: boolean;
  reconnectNotified: boolean;
}

export interface ConnectionObservation {
  reconnectDurationMs: number | null;
}

export interface WatchdogCallbacks {
  onChanged?: (devices: DeviceRuntimeStatus[]) => void;
  onFaultRaised?: (
    deviceId: QuestDeviceId,
    message: string,
  ) => void | Promise<void>;
  onFaultCleared?: (deviceId: QuestDeviceId) => void | Promise<void>;
  onCriticalTimeout?: (
    deviceId: QuestDeviceId,
    durationMs: number,
  ) => void | Promise<void>;
}

export class ConnectionWatchdog {
  private readonly devices = new Map<QuestDeviceId, InternalStatus>();
  private interval: NodeJS.Timeout | null = null;

  public constructor(
    private readonly callbacks: WatchdogCallbacks = {},
    private readonly clock: Clock = systemClock,
    private readonly heartbeatTimeoutMs = 1_500,
    private readonly criticalGraceMs = CRITICAL_FAULT_GRACE_MS,
  ) {}

  public configure(assignments: DeviceAssignment[]): void {
    this.devices.clear();
    for (const assignment of assignments) {
      this.devices.set(assignment.deviceId, {
        deviceId: assignment.deviceId,
        participantId: assignment.participantId,
        role: assignment.role,
        connected: false,
        simulation: false,
        state: "CONNECTING",
        calibrationStatus: "NOT_RUN",
        lastHeartbeatAtUtc: null,
        lastAppliedStateVersion: 0,
        clockOffsetMs: null,
        roundTripMs: null,
        faultStartedAtUtc: null,
        lastHeartbeatMonotonicMs: null,
        faultStartedMonotonicMs: null,
        criticalTimeoutNotified: false,
        reconnectNotified: false,
      });
    }
    this.emitChanged();
  }

  public start(): void {
    if (this.interval === null) {
      this.interval = setInterval(() => this.tick(), 250);
    }
  }

  public stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  public connected(
    deviceId: QuestDeviceId,
    simulation: boolean,
  ): ConnectionObservation {
    const status = this.requireDevice(deviceId);
    const nowMs = this.clock.monotonicNow();
    const reconnectDurationMs =
      status.faultStartedMonotonicMs === null
        ? null
        : nowMs - status.faultStartedMonotonicMs;
    status.connected = true;
    status.simulation = simulation;
    status.state = reconnectDurationMs === null ? "SYNCHRONIZING" : "RECOVERING";
    status.lastHeartbeatMonotonicMs = nowMs;
    status.lastHeartbeatAtUtc = isoNow(this.clock);
    status.reconnectNotified = reconnectDurationMs !== null;
    this.emitChanged();
    return { reconnectDurationMs };
  }

  public heartbeat(
    deviceId: QuestDeviceId,
    state: QuestState,
    lastAppliedStateVersion: number,
  ): ConnectionObservation {
    const status = this.requireDevice(deviceId);
    const nowMs = this.clock.monotonicNow();
    const newlyReconnected =
      status.faultStartedMonotonicMs !== null && !status.connected;
    const reconnectDurationMs = newlyReconnected
      ? nowMs - status.faultStartedMonotonicMs!
      : null;
    status.connected = true;
    status.state =
      status.faultStartedMonotonicMs === null ? state : "RECOVERING";
    status.lastAppliedStateVersion = lastAppliedStateVersion;
    status.lastHeartbeatMonotonicMs = nowMs;
    status.lastHeartbeatAtUtc = isoNow(this.clock);
    status.reconnectNotified ||= newlyReconnected;
    this.emitChanged();
    return { reconnectDurationMs };
  }

  public disconnected(
    deviceId: QuestDeviceId,
    message = "Quest disconnected.",
  ): void {
    const status = this.requireDevice(deviceId);
    status.connected = false;
    status.state = "FAULTED";
    if (status.reconnectNotified) {
      status.faultStartedAtUtc = null;
      status.faultStartedMonotonicMs = null;
      status.reconnectNotified = false;
      status.criticalTimeoutNotified = false;
    }
    this.raiseFault(status, message);
    this.emitChanged();
  }

  public confirmRecovered(deviceId: QuestDeviceId, state: QuestState): void {
    const status = this.requireDevice(deviceId);
    if (!status.connected || status.faultStartedMonotonicMs === null) {
      throw new Error(`${deviceId} has no connected recovery to confirm.`);
    }
    status.state = state;
    status.faultStartedAtUtc = null;
    status.faultStartedMonotonicMs = null;
    status.criticalTimeoutNotified = false;
    status.reconnectNotified = false;
    void this.callbacks.onFaultCleared?.(deviceId);
    this.emitChanged();
  }

  public setCalibration(
    deviceId: QuestDeviceId,
    calibrationStatus: CalibrationStatus,
  ): void {
    const status = this.requireDevice(deviceId);
    status.calibrationStatus = calibrationStatus;
    if (calibrationStatus === "PASS" || calibrationStatus === "OVERRIDDEN") {
      status.state = "READY";
    } else {
      status.state = "IDLE";
    }
    this.emitChanged();
  }

  public setState(
    deviceId: QuestDeviceId,
    state: QuestState,
    lastAppliedStateVersion: number,
  ): void {
    const status = this.requireDevice(deviceId);
    status.state = state;
    status.lastAppliedStateVersion = lastAppliedStateVersion;
    this.emitChanged();
  }

  public setClockEstimate(
    deviceId: QuestDeviceId,
    offsetMs: number,
    roundTripMs: number,
  ): void {
    const status = this.requireDevice(deviceId);
    status.clockOffsetMs = offsetMs;
    status.roundTripMs = roundTripMs;
    this.emitChanged();
  }

  public list(): DeviceRuntimeStatus[] {
    return [...this.devices.values()].map(
      ({
        lastHeartbeatMonotonicMs: _heartbeat,
        faultStartedMonotonicMs: _fault,
        criticalTimeoutNotified: _notified,
        reconnectNotified: _reconnect,
        ...status
      }) => ({ ...status }),
    );
  }

  public allConnectedAndReady(): boolean {
    const devices = [...this.devices.values()];
    return (
      devices.length === 2 &&
      devices.every(
        ({ connected, calibrationStatus }) =>
          connected &&
          (calibrationStatus === "PASS" ||
            calibrationStatus === "OVERRIDDEN"),
      )
    );
  }

  public tick(nowMs = this.clock.monotonicNow()): void {
    for (const status of this.devices.values()) {
      if (
        status.connected &&
        status.lastHeartbeatMonotonicMs !== null &&
        nowMs - status.lastHeartbeatMonotonicMs > this.heartbeatTimeoutMs
      ) {
        status.connected = false;
        status.state = "FAULTED";
        this.raiseFault(
          status,
          "Quest heartbeat timed out.",
          status.lastHeartbeatMonotonicMs,
        );
      }

      if (
        !status.connected &&
        status.faultStartedMonotonicMs !== null &&
        !status.criticalTimeoutNotified
      ) {
        const durationMs = nowMs - status.faultStartedMonotonicMs;
        if (durationMs > this.criticalGraceMs) {
          status.criticalTimeoutNotified = true;
          void this.callbacks.onCriticalTimeout?.(status.deviceId, durationMs);
        }
      }
    }
    this.emitChanged();
  }

  private raiseFault(
    status: InternalStatus,
    message: string,
    startedAtMs = this.clock.monotonicNow(),
  ): void {
    if (status.faultStartedMonotonicMs !== null) {
      return;
    }
    status.faultStartedMonotonicMs = startedAtMs;
    status.faultStartedAtUtc = new Date(
      this.clock.utcNow().getTime() -
        Math.max(0, this.clock.monotonicNow() - startedAtMs),
    ).toISOString();
    status.criticalTimeoutNotified = false;
    status.reconnectNotified = false;
    void this.callbacks.onFaultRaised?.(status.deviceId, message);
  }

  private requireDevice(deviceId: QuestDeviceId): InternalStatus {
    const status = this.devices.get(deviceId);
    if (status === undefined) {
      throw new Error(`Unknown Quest device: ${deviceId}.`);
    }
    return status;
  }

  private emitChanged(): void {
    this.callbacks.onChanged?.(this.list());
  }
}
