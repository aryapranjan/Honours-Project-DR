import { describe, expect, it } from "vitest";

import {
  areProtocolVersionsCompatible,
  evaluateCriticalDisconnect,
  evaluateStateChangingCommand,
  evaluateSubmitAttempt,
  type SeenCommand,
} from "../src/protocolRules.js";

describe("protocol compatibility", () => {
  it("accepts the same major version and rejects incompatible versions", () => {
    expect(areProtocolVersionsCompatible("1.0.0", "1.3.2")).toBe(true);
    expect(areProtocolVersionsCompatible("1.0.0", "2.0.0")).toBe(false);
    expect(areProtocolVersionsCompatible("1.0", "1.0.0")).toBe(false);
  });
});

describe("command idempotency and ordering", () => {
  const commandId = "1ed8b3cb-410f-4f14-8d18-e1e4f629870f";
  const seen = new Map<string, SeenCommand>([
    [commandId, { fingerprint: "same-payload", result: { ready: true } }],
  ]);

  it("returns the prior result for an identical duplicate", () => {
    expect(
      evaluateStateChangingCommand(
        5,
        { commandId, stateVersion: 6, fingerprint: "same-payload" },
        seen,
      ),
    ).toEqual({
      action: "RETURN_PRIOR_RESULT",
      priorResult: { ready: true },
    });
  });

  it("rejects command ID reuse with a different payload", () => {
    expect(
      evaluateStateChangingCommand(
        5,
        { commandId, stateVersion: 6, fingerprint: "different-payload" },
        seen,
      ),
    ).toEqual({ action: "REJECT", reason: "COMMAND_ID_REUSED" });
  });

  it("rejects stale and out-of-order state versions", () => {
    expect(
      evaluateStateChangingCommand(
        5,
        {
          commandId: "0460be02-f57f-41fc-af84-3c5f6eb716b5",
          stateVersion: 5,
          fingerprint: "new",
        },
        seen,
      ),
    ).toEqual({ action: "REJECT", reason: "STALE_STATE" });

    expect(
      evaluateStateChangingCommand(
        5,
        {
          commandId: "41a9a604-8066-4d18-94bf-6d13ed63e62d",
          stateVersion: 7,
          fingerprint: "new",
        },
        seen,
      ),
    ).toEqual({ action: "REJECT", reason: "OUT_OF_ORDER_STATE" });
  });
});

describe("reconnect rule", () => {
  it("uses an inclusive three-second grace period", () => {
    expect(evaluateCriticalDisconnect(3_000)).toBe(
      "CONTINUE_AFTER_STATE_SNAPSHOT",
    );
    expect(evaluateCriticalDisconnect(3_001)).toBe("INVALIDATE_TECHNICAL");
  });
});

describe("submission rule", () => {
  it("records incorrect attempts, gives Continue, and keeps the trial running", () => {
    expect(evaluateSubmitAttempt("TRIAL_ACTIVE", 0, 1, "INCORRECT")).toEqual({
      accepted: true,
      nextSubmissionCount: 1,
      emitStandardizedContinue: true,
      requestTrialStop: false,
    });
  });

  it("permits a later correct attempt and requests trial stop", () => {
    expect(evaluateSubmitAttempt("TRIAL_ACTIVE", 1, 2, "CORRECT")).toEqual({
      accepted: true,
      nextSubmissionCount: 2,
      emitStandardizedContinue: false,
      requestTrialStop: true,
    });
  });

  it("rejects attempts outside an active trial or out of sequence", () => {
    expect(evaluateSubmitAttempt("POST_TRIAL", 0, 1, "CORRECT")).toEqual({
      accepted: false,
      reason: "TRIAL_NOT_ACTIVE",
    });
    expect(evaluateSubmitAttempt("TRIAL_ACTIVE", 1, 3, "CORRECT")).toEqual({
      accepted: false,
      reason: "INVALID_ATTEMPT_NUMBER",
    });
  });
});
