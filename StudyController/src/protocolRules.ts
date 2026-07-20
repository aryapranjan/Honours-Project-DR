import {
  CRITICAL_FAULT_GRACE_MS,
  type LaptopState,
  type RuntimeDecision,
} from "./contracts.js";

export type CommandDecision =
  | { action: "ACCEPT" }
  | { action: "RETURN_PRIOR_RESULT"; priorResult: unknown }
  | {
      action: "REJECT";
      reason: "COMMAND_ID_REUSED" | "STALE_STATE" | "OUT_OF_ORDER_STATE";
    };

export interface SeenCommand {
  fingerprint: string;
  result: unknown;
}

export function evaluateStateChangingCommand(
  currentStateVersion: number,
  incoming: { commandId: string; stateVersion: number; fingerprint: string },
  seenCommands: ReadonlyMap<string, SeenCommand>,
): CommandDecision {
  const prior = seenCommands.get(incoming.commandId);

  if (prior !== undefined) {
    return prior.fingerprint === incoming.fingerprint
      ? { action: "RETURN_PRIOR_RESULT", priorResult: prior.result }
      : { action: "REJECT", reason: "COMMAND_ID_REUSED" };
  }

  if (incoming.stateVersion <= currentStateVersion) {
    return { action: "REJECT", reason: "STALE_STATE" };
  }

  if (incoming.stateVersion > currentStateVersion + 1) {
    return { action: "REJECT", reason: "OUT_OF_ORDER_STATE" };
  }

  return { action: "ACCEPT" };
}

export function areProtocolVersionsCompatible(
  localVersion: string,
  remoteVersion: string,
): boolean {
  const parseMajor = (version: string): number | null => {
    const match = /^([0-9]+)\.[0-9]+\.[0-9]+$/.exec(version);
    return match?.[1] === undefined ? null : Number(match[1]);
  };

  const localMajor = parseMajor(localVersion);
  const remoteMajor = parseMajor(remoteVersion);
  return localMajor !== null && localMajor === remoteMajor;
}

export type ReconnectDecision =
  | "CONTINUE_AFTER_STATE_SNAPSHOT"
  | "INVALIDATE_TECHNICAL";

export function evaluateCriticalDisconnect(
  durationMs: number,
): ReconnectDecision {
  return durationMs <= CRITICAL_FAULT_GRACE_MS
    ? "CONTINUE_AFTER_STATE_SNAPSHOT"
    : "INVALIDATE_TECHNICAL";
}

export type SubmitDecision =
  | {
      accepted: true;
      nextSubmissionCount: number;
      emitStandardizedContinue: boolean;
      requestTrialStop: boolean;
    }
  | {
      accepted: false;
      reason: "TRIAL_NOT_ACTIVE" | "INVALID_ATTEMPT_NUMBER";
    };

export function evaluateSubmitAttempt(
  laptopState: LaptopState,
  currentSubmissionCount: number,
  attemptNumber: number,
  runtimeDecision: RuntimeDecision,
): SubmitDecision {
  if (laptopState !== "TRIAL_ACTIVE") {
    return { accepted: false, reason: "TRIAL_NOT_ACTIVE" };
  }

  if (attemptNumber !== currentSubmissionCount + 1) {
    return { accepted: false, reason: "INVALID_ATTEMPT_NUMBER" };
  }

  return {
    accepted: true,
    nextSubmissionCount: attemptNumber,
    emitStandardizedContinue: runtimeDecision === "INCORRECT",
    requestTrialStop: runtimeDecision === "CORRECT",
  };
}
