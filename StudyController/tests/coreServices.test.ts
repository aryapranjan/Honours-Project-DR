import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCHEMA_VERSION,
  type DeviceAssignment,
  type SessionSnapshot,
} from "../src/contracts.js";
import { AuthoritativeTimer } from "../src/services/AuthoritativeTimer.js";
import { ClockSynchronizer } from "../src/services/ClockSynchronizer.js";
import { ConnectionWatchdog } from "../src/services/ConnectionWatchdog.js";
import { CounterbalanceScheduler } from "../src/services/CounterbalanceScheduler.js";
import { EventLogger } from "../src/services/EventLogger.js";
import { SnapshotManager } from "../src/services/SnapshotManager.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "cdr-phase3-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Phase 3 core services", () => {
  it("serializes concurrent event writes into a contiguous append-only log", async () => {
    const directory = await temporaryDirectory();
    const logger = await EventLogger.open(
      directory,
      "5d81618b-b713-4d67-8e81-b9096671b8b7",
    );

    await Promise.all(
      ["SESSION_CREATED", "EXPERIMENTER_ACTION", "EXPORT_VALIDATED"].map(
        (eventType) =>
          logger.append({
            trialId: null,
            stateVersion: 1,
            source: "SERVER",
            eventType,
            payload: {},
          }),
      ),
    );

    expect((await logger.readAll()).map(({ sequence }) => sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(
      (await readFile(logger.filePath, "utf8")).trim().split("\n"),
    ).toHaveLength(3);
  });

  it("writes and restores a schema-validated atomic snapshot", async () => {
    const root = await temporaryDirectory();
    const sessionDirectory = path.join(root, "PAIR-001");
    const manager = new SnapshotManager(root, sessionDirectory);
    const snapshot: SessionSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: "5d81618b-b713-4d67-8e81-b9096671b8b7",
      stateVersion: 7,
      lastEventSequence: 9,
      createdAtUtc: "2026-07-25T00:00:00.000Z",
      createdAtMonotonicMs: 1_000,
      laptopState: "PREFLIGHT",
      activeTrialId: null,
      currentTrialIndex: 1,
      trialStartedAtUtc: null,
      trialStartedAtMonotonicMs: null,
      submissionCount: 0,
      outcome: null,
      completedTrialIds: ["PRACTICE-01"],
      preflight: {
        directorQuestConnected: false,
        builderQuestConnected: false,
        recordingReady: true,
        storageReady: true,
        physicalDistractorConfirmed: true,
      },
      questStates: [
        {
          deviceId: "QUEST_A",
          state: "READY",
          lastAppliedStateVersion: 7,
        },
        {
          deviceId: "QUEST_B",
          state: "READY",
          lastAppliedStateVersion: 7,
        },
      ],
      recovery: {
        required: false,
        interruptedState: null,
        reason: null,
      },
    };

    await manager.write(snapshot);
    expect(await manager.loadLatest()).toEqual(snapshot);
  });

  it("loads the validated allocation and creates a linked reserve trial", async () => {
    const scheduler = new CounterbalanceScheduler(
      fileURLToPath(
        new URL("../examples/counterbalance-plan.example.json", import.meta.url),
      ),
    );
    const { allocation } = await scheduler.selectForPair("PAIR-001");
    const replacement = scheduler.createReplacement(
      allocation,
      allocation.schedule,
      "SCORED-01",
    );
    const updated = scheduler.appendReplacement(
      allocation.schedule,
      replacement,
    );

    expect(replacement.replacementForTrialId).toBe("SCORED-01");
    expect(replacement.puzzleId).toBe("RESERVE_EXAMPLE_01");
    expect(updated.trials).toHaveLength(8);
  });

  it("selects the lowest-round-trip clock sample", () => {
    const synchronizer = new ClockSynchronizer();
    synchronizer.record("QUEST_A", {
      serverSendMs: 1_000,
      clientReceiveMs: 1_012,
      clientSendMs: 1_014,
      serverReceiveMs: 1_024,
    });
    const estimate = synchronizer.record("QUEST_A", {
      serverSendMs: 2_000,
      clientReceiveMs: 2_006,
      clientSendMs: 2_007,
      serverReceiveMs: 2_011,
    });

    expect(estimate.roundTripMs).toBe(10);
    expect(estimate.offsetMs).toBe(1);
    expect(estimate.sampleCount).toBe(2);
  });

  it("keeps the stopwatch running after its threshold and reports it once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T00:00:00.000Z"));
    const clock = {
      utcNow: () => new Date(Date.now()),
      monotonicNow: () => Date.now(),
    };
    const expired = vi.fn();
    const timer = new AuthoritativeTimer(clock);

    timer.start(1_000, expired);
    await vi.advanceTimersByTimeAsync(400);
    expect(timer.view()).toMatchObject({
      running: true,
      elapsedMs: 400,
      limitReached: false,
      overrunMs: 0,
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(timer.view()).toMatchObject({
      running: true,
      elapsedMs: 1_000,
      limitReached: true,
      overrunMs: 0,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(timer.view()).toMatchObject({
      running: true,
      elapsedMs: 1_250,
      limitReached: true,
      overrunMs: 250,
    });
    expect(timer.stop()).toMatchObject({
      running: false,
      elapsedMs: 1_250,
      limitReached: true,
      overrunMs: 250,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(timer.view().elapsedMs).toBe(1_250);
  });

  it("raises the critical callback only after the three-second grace period", () => {
    let now = 0;
    const onCriticalTimeout = vi.fn();
    const watchdog = new ConnectionWatchdog(
      { onCriticalTimeout },
      {
        utcNow: () => new Date("2026-07-25T00:00:00.000Z"),
        monotonicNow: () => now,
      },
      1_500,
      3_000,
    );
    const assignments: DeviceAssignment[] = [
      {
        deviceId: "QUEST_A",
        participantId: "P001-A",
        role: "DIRECTOR",
        accessTokenRef: "secrets/a",
      },
      {
        deviceId: "QUEST_B",
        participantId: "P001-B",
        role: "BUILDER",
        accessTokenRef: "secrets/b",
      },
    ];
    watchdog.configure(assignments);
    watchdog.connected("QUEST_A", true);
    now = 1_501;
    watchdog.tick();
    expect(onCriticalTimeout).not.toHaveBeenCalled();
    now = 4_502;
    watchdog.tick();
    expect(onCriticalTimeout).toHaveBeenCalledTimes(1);
  });
});
