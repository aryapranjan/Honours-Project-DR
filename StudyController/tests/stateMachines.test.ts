import { describe, expect, it } from "vitest";

import {
  assertLaptopTransition,
  assertQuestTransition,
  canTransitionLaptop,
  canTransitionQuest,
} from "../src/stateMachines.js";

describe("laptop state machine", () => {
  it("accepts the guarded trial path", () => {
    const path = [
      "SERVER_READY",
      "SESSION_SETUP",
      "PREFLIGHT",
      "CALIBRATION",
      "TRIAL_PREPARED",
      "TRIAL_COMMITTED",
      "TRIAL_ACTIVE",
      "TRIAL_STOPPING",
      "POST_TRIAL",
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionLaptop(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it("rejects bypassing prepare and commit", () => {
    expect(canTransitionLaptop("PREFLIGHT", "TRIAL_ACTIVE")).toBe(false);
    expect(() =>
      assertLaptopTransition("PREFLIGHT", "TRIAL_ACTIVE"),
    ).toThrow("Invalid laptop transition");
  });
});

describe("Quest state machine", () => {
  it("accepts prepare, commit, start, and stop", () => {
    expect(canTransitionQuest("READY", "TRIAL_PREPARED")).toBe(true);
    expect(canTransitionQuest("TRIAL_PREPARED", "TRIAL_COMMITTED")).toBe(true);
    expect(canTransitionQuest("TRIAL_COMMITTED", "TRIAL_ACTIVE")).toBe(true);
    expect(canTransitionQuest("TRIAL_ACTIVE", "STOPPING")).toBe(true);
  });

  it("requires recovery before restoring an active state", () => {
    expect(canTransitionQuest("FAULTED", "TRIAL_ACTIVE")).toBe(false);
    expect(canTransitionQuest("FAULTED", "RECOVERING")).toBe(true);
    expect(canTransitionQuest("RECOVERING", "TRIAL_ACTIVE")).toBe(true);
    expect(() => assertQuestTransition("FAULTED", "TRIAL_ACTIVE")).toThrow(
      "Invalid Quest transition",
    );
  });
});
