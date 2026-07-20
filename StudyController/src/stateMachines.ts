import type { LaptopState, QuestState } from "./contracts.js";

const laptopTransitions: Readonly<Record<LaptopState, ReadonlySet<LaptopState>>> = {
  SERVER_READY: new Set(["SESSION_SETUP"]),
  SESSION_SETUP: new Set(["PREFLIGHT", "RECOVERY_REQUIRED"]),
  PREFLIGHT: new Set(["CALIBRATION", "BLOCKED"]),
  CALIBRATION: new Set(["TRIAL_PREPARED", "BLOCKED"]),
  BLOCKED: new Set(["PREFLIGHT", "CALIBRATION", "RECOVERY_REQUIRED"]),
  TRIAL_PREPARED: new Set(["TRIAL_COMMITTED", "BLOCKED"]),
  TRIAL_COMMITTED: new Set(["TRIAL_ACTIVE", "BLOCKED", "RECOVERY_REQUIRED"]),
  TRIAL_ACTIVE: new Set(["TRIAL_STOPPING", "RECOVERY_REQUIRED"]),
  TRIAL_STOPPING: new Set(["POST_TRIAL", "RECOVERY_REQUIRED"]),
  POST_TRIAL: new Set(["PREFLIGHT", "CONDITION_REVIEW", "SESSION_COMPLETE"]),
  CONDITION_REVIEW: new Set(["PREFLIGHT", "SESSION_COMPLETE"]),
  SESSION_COMPLETE: new Set(),
  RECOVERY_REQUIRED: new Set(["SESSION_SETUP", "PREFLIGHT", "BLOCKED"]),
};

const questTransitions: Readonly<Record<QuestState, ReadonlySet<QuestState>>> = {
  BOOTING: new Set(["PERMISSION_REQUIRED", "CONNECTING", "FAULTED"]),
  PERMISSION_REQUIRED: new Set(["CONNECTING", "FAULTED"]),
  CONNECTING: new Set(["SYNCHRONIZING", "RECOVERING", "FAULTED"]),
  SYNCHRONIZING: new Set(["IDLE", "RECOVERING", "FAULTED"]),
  IDLE: new Set(["CALIBRATING", "CONNECTING", "FAULTED"]),
  CALIBRATING: new Set(["READY", "IDLE", "RECOVERING", "FAULTED"]),
  READY: new Set([
    "TRIAL_PREPARED",
    "CALIBRATING",
    "CONNECTING",
    "RECOVERING",
    "FAULTED",
  ]),
  TRIAL_PREPARED: new Set([
    "TRIAL_COMMITTED",
    "READY",
    "RECOVERING",
    "FAULTED",
  ]),
  TRIAL_COMMITTED: new Set([
    "TRIAL_ACTIVE",
    "READY",
    "RECOVERING",
    "FAULTED",
  ]),
  TRIAL_ACTIVE: new Set(["STOPPING", "RECOVERING", "FAULTED"]),
  STOPPING: new Set(["READY", "IDLE", "RECOVERING", "FAULTED"]),
  FAULTED: new Set(["RECOVERING", "CONNECTING"]),
  RECOVERING: new Set([
    "CONNECTING",
    "SYNCHRONIZING",
    "IDLE",
    "CALIBRATING",
    "READY",
    "TRIAL_PREPARED",
    "TRIAL_COMMITTED",
    "TRIAL_ACTIVE",
    "STOPPING",
    "FAULTED",
  ]),
};

export function canTransitionLaptop(from: LaptopState, to: LaptopState): boolean {
  return laptopTransitions[from].has(to);
}

export function canTransitionQuest(from: QuestState, to: QuestState): boolean {
  return questTransitions[from].has(to);
}

export function assertLaptopTransition(
  from: LaptopState,
  to: LaptopState,
): void {
  if (!canTransitionLaptop(from, to)) {
    throw new Error(`Invalid laptop transition: ${from} -> ${to}`);
  }
}

export function assertQuestTransition(from: QuestState, to: QuestState): void {
  if (!canTransitionQuest(from, to)) {
    throw new Error(`Invalid Quest transition: ${from} -> ${to}`);
  }
}
