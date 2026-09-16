import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { sha256CanonicalJson } from "../src/canonicalJson.js";
import type { Clock } from "../src/clock.js";
import {
  DR_PROFILE_VERSION,
  PROTOCOL_VERSION,
  type DiminishedRealityStateReport,
  type DistractorType,
  type EnrollmentResult,
  type MessageEnvelope,
  type PairingCodeView,
  type QuestState,
  type Schedule,
} from "../src/contracts.js";
import type { DashboardState } from "../src/runtimeTypes.js";
import { createDeterministicCalibrationReport } from "../src/simulation/simulatedCalibrationReport.js";
import {
  createStudyServer,
  type RunningStudyServer,
} from "../src/server/createStudyServer.js";

const temporaryDirectories: string[] = [];
const runningServers: RunningStudyServer[] = [];
const planPath = fileURLToPath(
  new URL("../examples/counterbalance-plan.example.json", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    runningServers.splice(0).map(async (server) => {
      try {
        await server.close();
      } catch {
        // A test may already have closed the server to verify restart behavior.
      }
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      }),
    ),
  );
});

async function startServer(
  dataRoot: string,
  clock?: Clock,
  drPreviewEnabled = false,
): Promise<RunningStudyServer> {
  const server = await createStudyServer({
    host: "127.0.0.1",
    port: 0,
    dataRoot,
    counterbalancePlanPath: planPath,
    dashboardDistPath: path.join(dataRoot, "missing-dashboard"),
    startLeadMs: clock === undefined ? 5 : 0,
    drPreviewEnabled,
    ...(clock === undefined ? {} : { clock }),
  });
  runningServers.push(server);
  return server;
}

async function request<T>(
  server: RunningStudyServer,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `http://127.0.0.1:${server.port}${endpoint}`,
    {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

async function startPracticeTrial(
  server: RunningStudyServer,
): Promise<DashboardState> {
  await request(server, "/api/session", {
    pairId: "PAIR-001",
    participantAId: "P001-A",
    participantBId: "P001-B",
  });
  await request(server, "/api/simulation/start", {});
  return runPreflightAndStart(server, true);
}

async function runPreflightAndStart(
  server: RunningStudyServer,
  beginPreflight = false,
): Promise<DashboardState> {
  if (beginPreflight) {
    await request(server, "/api/preflight/begin", {});
  }
  for (const key of [
    "recordingReady",
    "storageReady",
    "physicalDistractorConfirmed",
  ]) {
    await request(server, "/api/preflight/item", { key, value: true });
  }
  await request(server, "/api/preflight/confirm", {});
  await request(server, "/api/calibration/start", {});
  await request(server, "/api/trial/prepare", {});
  return request(server, "/api/trial/start", { confirmed: true });
}

function createControllableClock(): {
  clock: Clock;
  setNow(value: number): void;
} {
  let now = 0;
  const epochMs = Date.parse("2026-07-25T00:00:00.000Z");
  return {
    clock: {
      utcNow: () => new Date(epochMs + now),
      monotonicNow: () => now,
    },
    setNow: (value) => {
      now = value;
    },
  };
}

function refreshSimulatedHeartbeats(server: RunningStudyServer): void {
  const state = server.manager.getDashboardState();
  for (const device of state.devices) {
    server.manager.watchdog.heartbeat(
      device.deviceId,
      device.state,
      state.stateVersion,
    );
  }
}

async function waitForState(
  server: RunningStudyServer,
  predicate: (state: DashboardState) => boolean,
  timeoutMs = 6_000,
): Promise<DashboardState> {
  const deadline = Date.now() + timeoutMs;
  let state = await request<DashboardState>(server, "/api/state");
  while (!predicate(state)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for dashboard state: ${JSON.stringify(state)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    state = await request<DashboardState>(server, "/api/state");
  }
  return state;
}

function connectTestQuest(
  enrollment: EnrollmentResult,
  calibrationTvOffsetMeters = 0,
): Promise<{
  socket: WebSocket;
  close(): void;
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(enrollment.websocketUrl, {
      headers: { Authorization: `Bearer ${enrollment.accessToken}` },
    });
    let heartbeatSequence = 0;
    let lastAppliedStateVersion = 0;
    let questState: QuestState = "CONNECTING";
    let localLogRetained = true;
    let drTarget: DistractorType | null = null;
    let drRequestedEnabled = false;
    let drPrepared = false;
    let drVisible = false;
    let drDebugBounds = false;
    let calibrationAttemptId: string | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const drState = (action: string): DiminishedRealityStateReport => ({
      requestedAction: action,
      target: drTarget,
      profileVersion: DR_PROFILE_VERSION,
      requestedEnabled: drRequestedEnabled,
      actualState: drVisible
        ? "VISIBLE"
        : drPrepared
          ? drRequestedEnabled
            ? action === "REVEAL"
              ? "REVEALED"
              : "PREPARED"
            : "NO_DR"
          : "HIDDEN",
      prepared: drPrepared,
      maskVisible: drVisible,
      debugBoundsVisible: drDebugBounds,
      geometryActive: drVisible,
      calibrationAttemptId,
      calibrationStatus: calibrationAttemptId === null ? "NOT_RUN" : "PASS",
      drStateMatches: true,
      measuredFps: drVisible ? 72 : null,
      performanceTargetFps: 72,
      performanceGateEvaluated: drVisible,
      performanceGatePass: drVisible ? true : null,
      reason: null,
    });

    const send = (
      type: MessageEnvelope["type"],
      trialId: string | null,
      commandId: string,
      stateVersion: number,
      payload: Record<string, unknown>,
    ): void => {
      const message: MessageEnvelope = {
        protocolVersion: PROTOCOL_VERSION,
        sessionId: enrollment.sessionId,
        trialId,
        commandId,
        stateVersion,
        sender: enrollment.deviceId,
        target: "SERVER",
        timestampUtc: new Date().toISOString(),
        timestampMonotonicMs: performance.now(),
        type,
        payload,
      };
      socket.send(JSON.stringify(message));
    };

    const sendHeartbeat = (): void => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      heartbeatSequence += 1;
      send("HEARTBEAT", null, randomUUID(), lastAppliedStateVersion, {
        sequence: heartbeatSequence,
        questState,
        lastAppliedStateVersion,
      });
    };

    socket.once("open", () => {
      questState = "SYNCHRONIZING";
      heartbeat = setInterval(sendHeartbeat, 400);
      resolve({
        socket,
        close: () => {
          if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          socket.close(1000, "Test Quest stopped.");
        },
      });
    });
    socket.once("error", reject);
    socket.on("close", () => {
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    });
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as MessageEnvelope;
      lastAppliedStateVersion = Math.max(
        lastAppliedStateVersion,
        message.stateVersion,
      );
      switch (message.type) {
        case "STATE_SNAPSHOT": {
          const payload = message.payload as {
            snapshot: Record<string, unknown>;
            snapshotHash: string;
          };
          if (sha256CanonicalJson(payload.snapshot) !== payload.snapshotHash) {
            socket.close(1008, "Test snapshot hash mismatch.");
            return;
          }
          questState = payload.snapshot.reconnectConfirmationRequired === true
            ? "RECOVERING"
            : (payload.snapshot.desiredQuestState as QuestState);
          send(
            "STATE_SNAPSHOT_APPLIED",
            message.trialId,
            message.commandId,
            message.stateVersion,
            {
              appliedStateVersion: message.stateVersion,
              snapshotHash: payload.snapshotHash,
              drState: drState("SNAPSHOT"),
            },
          );
          return;
        }
        case "PREPARE_TRIAL":
          drTarget = message.payload.drTarget as DistractorType;
          drRequestedEnabled = message.payload.drEnabled === true;
          drPrepared = true;
          drVisible = false;
          drDebugBounds = false;
          questState = "TRIAL_PREPARED";
          send("READY", message.trialId, message.commandId, message.stateVersion, {
            readiness: "READY",
            calibrationStatus: "PASS",
            calibrationOverrideReason: null,
            drStateMatches: true,
            drState: drState("PREPARE"),
            appVersion: enrollment.approvedQuestBuildId,
            deviceStatus: "TEST_QUEST_READY",
            reasons: [],
          });
          return;
        case "BEGIN_CALIBRATION":
          questState = "CALIBRATING";
          calibrationAttemptId = String(message.payload.attemptId);
          const report = createDeterministicCalibrationReport(
            String(message.payload.attemptId),
            false,
          );
          if (report.tvInKeyboardRig !== null) {
            report.tvInKeyboardRig.position.x += calibrationTvOffsetMeters;
          }
          send(
            "CALIBRATION_REPORT",
            message.trialId,
            message.commandId,
            message.stateVersion,
            {
              ...report,
            },
          );
          questState = "READY";
          return;
        case "COMMIT_START":
          drVisible = drPrepared && drRequestedEnabled;
          drDebugBounds = false;
          questState = "TRIAL_ACTIVE";
          send("STARTED", message.trialId, message.commandId, message.stateVersion, {
            appliedStateVersion: message.stateVersion,
            drState: drState("SHOW"),
          });
          return;
        case "STOP_TRIAL":
          drRequestedEnabled = false;
          drPrepared = false;
          drVisible = false;
          drDebugBounds = false;
          questState = "READY";
          send("STOPPED", message.trialId, message.commandId, message.stateVersion, {
            outcome: message.payload.outcome,
            appliedStateVersion: message.stateVersion,
            drState: drState("HIDE"),
          });
          return;
        case "DR_PREVIEW": {
          const action = String(message.payload.action);
          if (action === "PREPARE") {
            drTarget = message.payload.target as DistractorType;
            drRequestedEnabled = true;
            drPrepared = true;
            drVisible = false;
            drDebugBounds = false;
          } else if (action === "SHOW") {
            drVisible = drPrepared && drRequestedEnabled;
          } else if (action === "HIDE") {
            drRequestedEnabled = false;
            drPrepared = false;
            drVisible = false;
            drDebugBounds = false;
          } else if (action === "REVEAL") {
            drVisible = false;
          } else if (action === "SET_DEBUG_BOUNDS") {
            drDebugBounds = message.payload.debugBounds === true;
          }
          send(
            "DR_STATE_REPORT",
            message.trialId,
            message.commandId,
            message.stateVersion,
            { ...drState(action) },
          );
          return;
        }
        case "CONTINUE_AFTER_RECOVERY":
          questState = "TRIAL_ACTIVE";
          send("CONTINUED", message.trialId, message.commandId, message.stateVersion, {
            appliedStateVersion: message.payload.snapshotStateVersion,
            snapshotHash: message.payload.snapshotHash,
          });
          return;
        case "REQUEST_LOCAL_LOG_STATUS":
          send("LOCAL_LOG_STATUS", null, message.commandId, message.stateVersion, {
            sessionId: enrollment.sessionId,
            retained: localLogRetained,
            recordCount: localLogRetained ? 12 : 0,
            sha256: localLogRetained
              ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
              : null,
          });
          return;
        case "CLEANUP_LOCAL_LOG":
          localLogRetained = false;
          send("LOCAL_LOG_CLEANED", null, message.commandId, message.stateVersion, {
            sessionId: enrollment.sessionId,
            deleted: true,
          });
          return;
        default:
          return;
      }
    });
  });
}

function expectQuestConnectionRejected(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Unauthenticated Quest WebSocket was not rejected."));
    }, 2_000);
    socket.once("error", () => {
      // A close-frame or transport rejection is acceptable here.
    });
    socket.once("close", (code) => {
      clearTimeout(timeout);
      try {
        expect(code).toBe(1008);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("Phase 4 networking foundation", () => {
  it(
    "enrolls a physical Quest beside one slot simulator, gates recovery, and cleans logs only after a valid export",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-phase4-hybrid-"));
      temporaryDirectories.push(dataRoot);
      const server = await startServer(dataRoot);
      await request(server, "/api/session", {
        pairId: "PAIR-001",
        participantAId: "P001-A",
        participantBId: "P001-B",
      });

      const pairing = await request<PairingCodeView>(
        server,
        "/api/enrollment/code",
        { deviceId: "QUEST_A" },
      );
      expect(pairing).toMatchObject({ deviceId: "QUEST_A" });
      expect(pairing.code).toMatch(/^\d{6}$/);
      await expect(
        request(server, "/api/enrollment/redeem", {
          pairingCode: pairing.code,
          clientInstanceId: "physical-quest-install-0001",
          protocolVersion: PROTOCOL_VERSION,
          appBuildId: "unapproved-build",
        }),
      ).rejects.toThrow("not the approved build");

      const enrollment = await request<EnrollmentResult>(
        server,
        "/api/enrollment/redeem",
        {
          pairingCode: pairing.code,
          clientInstanceId: "physical-quest-install-0001",
          protocolVersion: PROTOCOL_VERSION,
          appBuildId: "cdr-phase6-dev-1",
        },
      );
      expect(Object.keys(enrollment).sort()).toEqual([
        "accessToken",
        "approvedQuestBuildId",
        "deviceId",
        "participantId",
        "protocolVersion",
        "role",
        "sessionId",
        "websocketUrl",
      ]);
      expect(enrollment).toMatchObject({
        deviceId: "QUEST_A",
        participantId: "P001-A",
        protocolVersion: "1.3.0",
        approvedQuestBuildId: "cdr-phase6-dev-1",
      });
      await expectQuestConnectionRejected(enrollment.websocketUrl);

      const physicalQuest = await connectTestQuest(enrollment);
      await request(server, "/api/simulation/start", { deviceId: "QUEST_B" });
      let state = await waitForState(
        server,
        (candidate) =>
          candidate.devices.every(({ connected }) => connected) &&
          candidate.enrollments.some(
            ({ deviceId, paired, simulation }) =>
              deviceId === "QUEST_A" && paired && !simulation,
          ) &&
          candidate.enrollments.some(
            ({ deviceId, paired, simulation }) =>
              deviceId === "QUEST_B" && paired && simulation,
          ),
      );
      expect(state.serverConnection).toMatchObject({
        bindHost: "127.0.0.1",
        approvedQuestBuildId: "cdr-phase6-dev-1",
        protocolVersion: "1.3.0",
      });
      expect(state.serverConnection.advertisedWebSocketUrl).toBe(
        `ws://127.0.0.1:${server.port}`,
      );

      state = await runPreflightAndStart(server, true);
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.calibrationReports).toHaveLength(2);
      expect(state.calibrationReports.find(({ deviceId }) =>
        deviceId === "QUEST_A")?.report.simulation).toBe(false);
      expect(state.calibrationReports.find(({ deviceId }) =>
        deviceId === "QUEST_B")?.report.simulation).toBe(true);
      expect(state.calibrationComparison.status).toBe("DEFERRED");
      await request(server, "/api/simulation/disconnect", {
        deviceId: "QUEST_B",
        durationMs: 100,
      });
      state = await waitForState(
        server,
        (candidate) =>
          candidate.liveReconnects.some(
            ({ deviceId, phase }) =>
              deviceId === "QUEST_B" &&
              phase === "AWAITING_EXPERIMENTER_CONFIRMATION",
          ),
      );
      expect(state.timer.running).toBe(true);
      expect(state.availableActions).not.toContain("RECORD_SUBMISSION");
      expect(state.availableActions).toContain(
        "CONFIRM_RECONNECT_CONTINUATION",
      );
      await expect(
        request(server, "/api/trial/submission", {
          runtimeDecision: "INCORRECT",
        }),
      ).rejects.toThrow("reconnect must be validated and confirmed");

      state = await request(server, "/api/recovery/confirm-continuation", {
        deviceId: "QUEST_B",
        confirmed: true,
      });
      expect(state.liveReconnects).toEqual([]);
      expect(state.timer.running).toBe(true);
      expect(state.availableActions).toContain("RECORD_SUBMISSION");

      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "CORRECT",
      });
      state = await request(server, "/api/post-trial/complete", {});
      while (state.laptopState !== "SESSION_COMPLETE") {
        state = await runPreflightAndStart(
          server,
          state.laptopState === "CONDITION_REVIEW",
        );
        state = await request(server, "/api/trial/submission", {
          runtimeDecision: "CORRECT",
        });
        state = await request(server, "/api/post-trial/complete", {});
      }

      await expect(
        request(server, "/api/quest-logs/cleanup", { confirmed: true }),
      ).rejects.toThrow("Validate the laptop export");
      const report = await request<{ valid: boolean }>(
        server,
        "/api/export/validate",
        {},
      );
      expect(report.valid).toBe(true);
      state = await request(server, "/api/quest-logs/cleanup", {
        confirmed: true,
      });
      expect(state.localLogs).toHaveLength(2);
      expect(state.localLogs.every(({ retained }) => !retained)).toBe(true);

      const events = (
        await readFile(
          path.join(dataRoot, "PAIR-001", "authoritative-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { eventType: string });
      expect(
        events.some(
          ({ eventType }) => eventType === "RECONNECT_CONTINUATION_CONFIRMED",
        ),
      ).toBe(true);
      expect(
        events.filter(
          ({ eventType }) => eventType === "QUEST_LOCAL_LOG_CLEANED",
        ),
      ).toHaveLength(2);
      physicalQuest.close();
    },
    30_000,
  );

  it(
    "technically invalidates an active trial after the disconnect grace period",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-phase4-timeout-"));
      temporaryDirectories.push(dataRoot);
      const server = await startServer(dataRoot);
      let state = await startPracticeTrial(server);
      expect(state.laptopState).toBe("TRIAL_ACTIVE");

      await request(server, "/api/simulation/stop", { deviceId: "QUEST_A" });
      await waitForState(
        server,
        (candidate) =>
          candidate.liveReconnects.some(
            ({ deviceId, phase }) =>
              deviceId === "QUEST_A" && phase === "DISCONNECTED",
          ),
      );
      server.manager.watchdog.tick(performance.now() + 3_100);
      state = await waitForState(
        server,
        (candidate) => candidate.laptopState === "POST_TRIAL",
      );
      expect(state.currentTrial?.outcome).toBe("TECHNICAL_INVALID");
      expect(state.timer.running).toBe(false);
      expect(state.liveReconnects).toEqual([]);
    },
    20_000,
  );
});

describe("Phase 5 calibration reports", () => {
  async function startTwoPhysicalQuests(
    server: RunningStudyServer,
    questBTvOffsetMeters = 0,
  ): Promise<Array<{ close(): void }>> {
    await request(server, "/api/session", {
      pairId: "PAIR-001",
      participantAId: "P001-A",
      participantBId: "P001-B",
    });
    const connections: Array<{ close(): void }> = [];
    for (const deviceId of ["QUEST_A", "QUEST_B"] as const) {
      const pairing = await request<PairingCodeView>(
        server,
        "/api/enrollment/code",
        { deviceId },
      );
      const enrollment = await request<EnrollmentResult>(
        server,
        "/api/enrollment/redeem",
        {
          pairingCode: pairing.code,
          clientInstanceId: `physical-${deviceId.toLowerCase()}-phase5`,
          protocolVersion: PROTOCOL_VERSION,
          appBuildId: "cdr-phase6-dev-1",
        },
      );
      connections.push(
        await connectTestQuest(
          enrollment,
          deviceId === "QUEST_B" ? questBTvOffsetMeters : 0,
        ),
      );
    }
    await waitForState(
      server,
      (state) => state.devices.every(({ connected }) => connected),
    );
    return connections;
  }

  async function enterCalibration(server: RunningStudyServer): Promise<void> {
    await request(server, "/api/preflight/begin", {});
    for (const key of [
      "recordingReady",
      "storageReady",
      "physicalDistractorConfirmed",
    ]) {
      await request(server, "/api/preflight/item", { key, value: true });
    }
    await request(server, "/api/preflight/confirm", {});
  }

  it("accepts compatible rig-relative transforms from two physical Quests", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-phase5-compatible-"));
    temporaryDirectories.push(dataRoot);
    const server = await startServer(dataRoot);
    const quests = await startTwoPhysicalQuests(server);
    await enterCalibration(server);

    const state = await request<DashboardState>(
      server,
      "/api/calibration/start",
      {},
    );

    expect(state.calibrationReports).toHaveLength(2);
    expect(state.calibrationReports.every(({ report }) =>
      report.status === "PASS" && !report.simulation && !report.rawFramesPersisted,
    )).toBe(true);
    expect(state.calibrationComparison).toMatchObject({
      status: "PASS",
      tvPositionDifferenceMeters: 0,
      tvRotationDifferenceDegrees: 0,
    });
    expect(state.devices.every(({ state: questState }) =>
      questState === "READY",
    )).toBe(true);
    quests.forEach((quest) => quest.close());
  });

  it("blocks the start gate when physical Quest transforms disagree", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-phase5-disagree-"));
    temporaryDirectories.push(dataRoot);
    const server = await startServer(dataRoot);
    const quests = await startTwoPhysicalQuests(server, 0.08);
    await enterCalibration(server);

    const state = await request<DashboardState>(
      server,
      "/api/calibration/start",
      {},
    );

    expect(state.calibrationComparison.status).toBe("FAIL");
    expect(state.calibrationComparison.tvPositionDifferenceMeters).toBeCloseTo(0.08);
    expect(state.devices.every(({ calibrationStatus }) =>
      calibrationStatus === "FAIL",
    )).toBe(true);
    expect(state.devices.every(({ state: questState }) =>
      questState === "IDLE",
    )).toBe(true);
    expect(state.availableActions).toContain("PREPARE_TRIAL");
    await expect(request(server, "/api/trial/prepare", {})).rejects.toThrow(
      "Both Quests must be connected and calibrated",
    );
    quests.forEach((quest) => quest.close());
  });
});

describe("Phase 6 diminished-reality control", () => {
  it("reports prepared, visible, revealed, and hidden states through the guarded preview", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-phase6-preview-"));
    temporaryDirectories.push(dataRoot);
    const server = await startServer(dataRoot, undefined, true);

    await request(server, "/api/session", {
      pairId: "PAIR-001",
      participantAId: "P001-A",
      participantBId: "P001-B",
    });
    await request(server, "/api/simulation/start", {});
    await request(server, "/api/preflight/begin", {});
    for (const key of [
      "recordingReady",
      "storageReady",
      "physicalDistractorConfirmed",
    ]) {
      await request(server, "/api/preflight/item", { key, value: true });
    }
    await request(server, "/api/preflight/confirm", {});
    await request(server, "/api/calibration/start", {});

    let state = await request<DashboardState>(server, "/api/dr-preview", {
      action: "PREPARE",
      target: "TV",
    });
    expect(state.drPreview.reports).toHaveLength(2);
    expect(
      state.drPreview.reports.every(
        ({ report }) =>
          report.actualState === "PREPARED" &&
          report.prepared &&
          !report.geometryActive,
      ),
    ).toBe(true);

    state = await request(server, "/api/dr-preview", {
      action: "SHOW",
      target: "TV",
    });
    expect(
      state.drPreview.reports.every(
        ({ report }) => report.actualState === "VISIBLE" && report.maskVisible,
      ),
    ).toBe(true);

    state = await request(server, "/api/dr-preview", {
      action: "REVEAL",
      target: "TV",
    });
    expect(
      state.drPreview.reports.every(
        ({ report }) =>
          report.actualState === "REVEALED" && !report.geometryActive,
      ),
    ).toBe(true);

    state = await request(server, "/api/dr-preview", {
      action: "HIDE",
      target: "TV",
    });
    expect(
      state.drPreview.reports.every(
        ({ report }) => report.actualState === "HIDDEN" && !report.prepared,
      ),
    ).toBe(true);
  });
});

describe("Phase 3 server exit gates", () => {
  it(
    "runs simulated practice and scored trials, preserves browser state, and restores a non-active restart",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-server-"));
      temporaryDirectories.push(dataRoot);
      const server = await startServer(dataRoot);
      let state = await startPracticeTrial(server);
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.timer.running).toBe(true);

      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "INCORRECT",
      });
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.currentTrial?.submissionCount).toBe(1);
      expect(state.timer.running).toBe(true);

      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "CORRECT",
      });
      expect(state.laptopState).toBe("POST_TRIAL");
      state = await request(server, "/api/post-trial/complete", {});
      expect(state.laptopState).toBe("PREFLIGHT");

      state = await runPreflightAndStart(server);
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.currentTrial?.definition.trialId).toBe("SCORED-01");
      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "CORRECT",
      });
      expect(state.laptopState).toBe("POST_TRIAL");
      state = await request(server, "/api/post-trial/complete", {});
      expect(state.laptopState).toBe("PREFLIGHT");

      const refreshed = await request<DashboardState>(server, "/api/state");
      expect(refreshed.session?.config.sessionId).toBe(
        state.session?.config.sessionId,
      );
      expect(refreshed.completedTrialIds).toEqual([
        "PRACTICE-01",
        "SCORED-01",
      ]);

      await server.close();
      runningServers.splice(runningServers.indexOf(server), 1);
      const restored = await startServer(dataRoot);
      const restoredState = restored.manager.getDashboardState();
      expect(restoredState.laptopState).toBe("PREFLIGHT");
      expect(restoredState.timer.running).toBe(false);
      expect(restoredState.completedTrialIds).toEqual([
        "PRACTICE-01",
        "SCORED-01",
      ]);

      const events = (
        await readFile(
          path.join(
            dataRoot,
            "PAIR-001",
            "authoritative-events.jsonl",
          ),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { sequence: number; eventType: string });
      expect(events.map(({ sequence }) => sequence)).toEqual(
        events.map((_, index) => index + 1),
      );
      expect(events.some(({ eventType }) => eventType === "TRIAL_STARTED")).toBe(
        true,
      );
      expect(
        events.some(({ eventType }) => eventType === "TRIAL_OUTCOME_RECORDED"),
      ).toBe(true);
    },
    20_000,
  );

  it(
    "records post-limit submissions and ends a late correct finish as TIMEOUT",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-late-finish-"));
      temporaryDirectories.push(dataRoot);
      const controlled = createControllableClock();
      const server = await startServer(dataRoot, controlled.clock);
      let state = await startPracticeTrial(server);
      expect(state.timer).toMatchObject({
        running: true,
        elapsedMs: 0,
        limitReached: false,
      });
      await expect(
        request(server, "/api/trial/time-limit", { confirmed: true }),
      ).rejects.toThrow("has not been reached");

      controlled.setNow(420_250);
      refreshSimulatedHeartbeats(server);
      state = await request(server, "/api/state");
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.timer).toMatchObject({
        running: true,
        timeLimitMs: 420_000,
        elapsedMs: 420_250,
        limitReached: true,
        overrunMs: 250,
      });
      expect(state.availableActions).toContain("END_TIME_LIMIT");
      expect(state.availableActions).toContain("RECORD_SUBMISSION");

      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "INCORRECT",
      });
      expect(state.laptopState).toBe("TRIAL_ACTIVE");
      expect(state.currentTrial?.submissionCount).toBe(1);

      controlled.setNow(421_500);
      refreshSimulatedHeartbeats(server);
      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "CORRECT",
      });
      expect(state.laptopState).toBe("POST_TRIAL");
      expect(state.currentTrial?.outcome).toBe("TIMEOUT");
      expect(state.timer).toMatchObject({
        running: false,
        elapsedMs: 421_500,
        limitReached: true,
        overrunMs: 1_500,
      });

      const events = (
        await readFile(
          path.join(dataRoot, "PAIR-001", "authoritative-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              eventType: string;
              payload: Record<string, unknown>;
            },
        );
      expect(
        events.filter(({ eventType }) => eventType === "TIME_LIMIT_REACHED"),
      ).toHaveLength(1);
      expect(
        events.filter(
          ({ eventType }) => eventType === "SUBMISSION_RECORDED",
        ).map(({ payload }) => payload),
      ).toEqual([
        {
          attemptNumber: 1,
          elapsedMs: 420_250,
          runtimeDecision: "INCORRECT",
          afterTimeLimit: true,
        },
        {
          attemptNumber: 2,
          elapsedMs: 421_500,
          runtimeDecision: "CORRECT",
          afterTimeLimit: true,
        },
      ]);
      expect(
        events.find(
          ({ eventType }) => eventType === "TRIAL_OUTCOME_RECORDED",
        )?.payload,
      ).toMatchObject({
        outcome: "TIMEOUT",
        elapsedMs: 421_500,
        completedAfterTimeLimit: true,
        lateCorrectCompletionMs: 421_500,
      });

      await request(server, "/api/export/validate", {});
      const [header, timeoutRow] = (
        await readFile(
          path.join(dataRoot, "PAIR-001", "trial-summary.csv"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      const columns = header!.split(",");
      const values = timeoutRow!.split(",");
      expect(values[columns.indexOf("duration_ms")]).toBe("421500");
      expect(values[columns.indexOf("completed_after_time_limit")]).toBe(
        "true",
      );
      expect(values[columns.indexOf("late_correct_completion_ms")]).toBe(
        "421500",
      );
      expect(values[columns.indexOf("live_final_accuracy")]).toBe("CORRECT");
    },
    20_000,
  );

  it(
    "keeps the guarded manual timeout available when no late correct finish occurs",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-time-limit-"));
      temporaryDirectories.push(dataRoot);
      const controlled = createControllableClock();
      const server = await startServer(dataRoot, controlled.clock);
      await startPracticeTrial(server);
      controlled.setNow(420_250);
      refreshSimulatedHeartbeats(server);

      const state = await request<DashboardState>(
        server,
        "/api/trial/time-limit",
        { confirmed: true },
      );
      expect(state.laptopState).toBe("POST_TRIAL");
      expect(state.currentTrial?.outcome).toBe("TIMEOUT");
      expect(state.timer).toMatchObject({
        running: false,
        elapsedMs: 420_250,
        overrunMs: 250,
      });

      const events = (
        await readFile(
          path.join(dataRoot, "PAIR-001", "authoritative-events.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              eventType: string;
              payload: Record<string, unknown>;
            },
        );
      expect(
        events.find(
          ({ eventType, payload }) =>
            eventType === "EXPERIMENTER_ACTION" &&
            payload.action === "END_TRIAL_TIME_LIMIT",
        )?.payload,
      ).toMatchObject({
        timeLimitMs: 420_000,
        elapsedMs: 420_250,
        overrunMs: 250,
      });
      expect(
        events.find(
          ({ eventType }) => eventType === "TRIAL_OUTCOME_RECORDED",
        )?.payload,
      ).toMatchObject({
        outcome: "TIMEOUT",
        completedAfterTimeLimit: false,
        lateCorrectCompletionMs: null,
      });
    },
    20_000,
  );

  it(
    "enters recovery after an active-trial restart and never resumes the stopwatch",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-recovery-"));
      temporaryDirectories.push(dataRoot);
      const server = await startServer(dataRoot);
      const active = await startPracticeTrial(server);
      expect(active.laptopState).toBe("TRIAL_ACTIVE");

      await server.close();
      runningServers.splice(runningServers.indexOf(server), 1);
      const restored = await startServer(dataRoot);
      let state = restored.manager.getDashboardState();
      expect(state.laptopState).toBe("RECOVERY_REQUIRED");
      expect(state.recovery.required).toBe(true);
      expect(state.timer.running).toBe(false);

      state = await request(restored, "/api/recovery/resolve", {
        outcome: "TECHNICAL_INVALID",
        confirmed: true,
        reason: "Automated restart recovery test.",
      });
      expect(state.laptopState).toBe("PREFLIGHT");
      expect(state.timer.running).toBe(false);
      expect(state.completedTrialIds).toEqual(["PRACTICE-01"]);
    },
    20_000,
  );

  it(
    "retains a technically invalid scored trial, schedules its reserve, and excludes it from analysis",
    async () => {
      const dataRoot = await mkdtemp(path.join(tmpdir(), "cdr-reserve-"));
      temporaryDirectories.push(dataRoot);
      const server = await startServer(dataRoot);
      let state = await startPracticeTrial(server);
      state = await request(server, "/api/trial/submission", {
        runtimeDecision: "CORRECT",
      });
      expect(state.laptopState).toBe("POST_TRIAL");
      await request(server, "/api/post-trial/complete", {});

      state = await runPreflightAndStart(server);
      expect(state.currentTrial?.definition.trialId).toBe("SCORED-01");
      state = await request(server, "/api/trial/invalidate", {
        confirmed: true,
        reason: "Simulated technical failure.",
      });
      expect(state.laptopState).toBe("POST_TRIAL");
      expect(state.currentTrial?.outcome).toBe("TECHNICAL_INVALID");

      const schedule = JSON.parse(
        await readFile(
          path.join(dataRoot, "PAIR-001", "schedule.json"),
          "utf8",
        ),
      ) as Schedule;
      const replacement = schedule.trials.find(
        ({ replacementForTrialId }) => replacementForTrialId === "SCORED-01",
      );
      expect(replacement?.kind).toBe("REPLACEMENT");
      expect(replacement?.puzzleId).toBe("RESERVE_EXAMPLE_01");

      await request(server, "/api/post-trial/complete", {});
      await request(server, "/api/export/validate", {});
      const csv = await readFile(
        path.join(dataRoot, "PAIR-001", "trial-summary.csv"),
        "utf8",
      );
      const invalidRow = csv
        .trim()
        .split("\n")
        .find((line) => line.includes(",SCORED-01,"));
      expect(invalidRow).toBeDefined();
      expect(invalidRow?.split(",").at(-1)).toBe("false");
    },
    20_000,
  );
});
