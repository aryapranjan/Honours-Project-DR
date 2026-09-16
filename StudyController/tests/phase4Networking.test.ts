import { describe, expect, it, vi } from "vitest";

import { canonicalJson, sha256CanonicalJson } from "../src/canonicalJson.js";
import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type DeviceAssignment,
  type SessionConfig,
} from "../src/contracts.js";
import { ConnectionWatchdog } from "../src/services/ConnectionWatchdog.js";
import { EnrollmentManager } from "../src/services/EnrollmentManager.js";

const assignments: DeviceAssignment[] = [
  {
    deviceId: "QUEST_A",
    participantId: "P001-A",
    role: "DIRECTOR",
    accessTokenRef: "runtime-secrets/quest-a",
  },
  {
    deviceId: "QUEST_B",
    participantId: "P001-B",
    role: "BUILDER",
    accessTokenRef: "runtime-secrets/quest-b",
  },
];

function sessionConfig(): SessionConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    studyId: "CDR",
    sessionId: "5d81618b-b713-4d67-8e81-b9096671b8b7",
    pairId: "PAIR-001",
    createdAtUtc: "2026-08-10T00:00:00.000Z",
    approvedQuestBuildId: "cdr-phase4-dev-1",
    trialDurationSeconds: 420,
    asymmetricRecipient: "DIRECTOR",
    deviceAssignments: assignments,
    calibrationPolicy: {
      manualOverrideAllowed: true,
      thresholdProfile: null,
    },
    schedulePath: "schedule.json",
    scheduleSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

describe("Phase 4 canonical snapshots", () => {
  it("recursively sorts object keys while preserving array order", () => {
    const left = {
      z: [{ y: 2, x: 1 }],
      a: { d: 4, c: 3 },
    };
    const right = {
      a: { c: 3, d: 4 },
      z: [{ x: 1, y: 2 }],
    };
    expect(canonicalJson(left)).toBe(
      '{"a":{"c":3,"d":4},"z":[{"x":1,"y":2}]}',
    );
    expect(sha256CanonicalJson(left)).toBe(sha256CanonicalJson(right));
  });
});

describe("Phase 4 enrollment", () => {
  it("issues a one-use slot-specific code and authenticates only its hashed token", () => {
    let now = 0;
    const enrollment = new EnrollmentManager(
      {
        utcNow: () => new Date(Date.parse("2026-08-10T00:00:00.000Z") + now),
        monotonicNow: () => now,
      },
      1_000,
    );
    enrollment.configure(sessionConfig());
    const pairing = enrollment.issuePairingCode("QUEST_A");
    expect(pairing.code).toMatch(/^\d{6}$/);

    expect(() =>
      enrollment.redeem({
        pairingCode: pairing.code,
        clientInstanceId: "quest-install-0001",
        protocolVersion: "2.0.0",
        appBuildId: "cdr-phase4-dev-1",
      }),
    ).toThrow("incompatible");
    expect(() =>
      enrollment.redeem({
        pairingCode: pairing.code,
        clientInstanceId: "quest-install-0001",
        protocolVersion: PROTOCOL_VERSION,
        appBuildId: "wrong-build",
      }),
    ).toThrow("not the approved build");

    const issued = enrollment.redeem({
      pairingCode: pairing.code,
      clientInstanceId: "quest-install-0001",
      protocolVersion: "1.9.0",
      appBuildId: "cdr-phase4-dev-1",
    });
    expect(issued.identity).toMatchObject({
      deviceId: "QUEST_A",
      participantId: "P001-A",
      role: "DIRECTOR",
      simulation: false,
    });
    expect(enrollment.authenticate(issued.accessToken)).toEqual(issued.identity);
    expect(JSON.stringify(enrollment.list())).not.toContain(issued.accessToken);
    expect(() => enrollment.authenticate("wrong-token")).toThrow(
      "bearer token is invalid",
    );
    expect(() =>
      enrollment.redeem({
        pairingCode: pairing.code,
        clientInstanceId: "quest-install-0002",
        protocolVersion: PROTOCOL_VERSION,
        appBuildId: "cdr-phase4-dev-1",
      }),
    ).toThrow("already been used");

    const expiring = enrollment.issuePairingCode("QUEST_B");
    now = 1_001;
    expect(() =>
      enrollment.redeem({
        pairingCode: expiring.code,
        clientInstanceId: "quest-install-0002",
        protocolVersion: PROTOCOL_VERSION,
        appBuildId: "cdr-phase4-dev-1",
      }),
    ).toThrow("expired");
  });

  it("keeps simulator enrollment slot-selective and releasable", () => {
    const enrollment = new EnrollmentManager();
    enrollment.configure(sessionConfig());
    const simulated = enrollment.enrollSimulation("QUEST_B");
    expect(simulated.identity).toMatchObject({
      deviceId: "QUEST_B",
      simulation: true,
    });
    expect(() => enrollment.enrollSimulation("QUEST_B")).toThrow(
      "already enrolled",
    );
    enrollment.releaseSimulation("QUEST_B");
    expect(enrollment.list().find(({ deviceId }) => deviceId === "QUEST_B"))
      .toMatchObject({ paired: false });
  });
});

describe("Phase 4 disconnect timing", () => {
  it("invalidates at 3001 ms, measured from disconnect", () => {
    let now = 0;
    const onCriticalTimeout = vi.fn();
    const watchdog = new ConnectionWatchdog(
      { onCriticalTimeout },
      {
        utcNow: () => new Date(Date.parse("2026-08-10T00:00:00.000Z") + now),
        monotonicNow: () => now,
      },
      1_500,
      3_000,
    );
    watchdog.configure(assignments);
    watchdog.connected("QUEST_A", false);
    watchdog.disconnected("QUEST_A");
    now = 3_000;
    watchdog.tick();
    expect(onCriticalTimeout).not.toHaveBeenCalled();
    now = 3_001;
    watchdog.tick();
    expect(onCriticalTimeout).toHaveBeenCalledWith("QUEST_A", 3_001);
  });

  it("measures silent heartbeat loss from the last good heartbeat", () => {
    let now = 0;
    const onCriticalTimeout = vi.fn();
    const watchdog = new ConnectionWatchdog(
      { onCriticalTimeout },
      {
        utcNow: () => new Date(Date.parse("2026-08-10T00:00:00.000Z") + now),
        monotonicNow: () => now,
      },
      1_500,
      3_000,
    );
    watchdog.configure(assignments);
    watchdog.connected("QUEST_A", false);
    now = 1_501;
    watchdog.tick();
    expect(onCriticalTimeout).not.toHaveBeenCalled();
    now = 3_001;
    watchdog.tick();
    expect(onCriticalTimeout).toHaveBeenCalledWith("QUEST_A", 3_001);
  });
});
