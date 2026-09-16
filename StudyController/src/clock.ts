import { performance } from "node:perf_hooks";

export interface Clock {
  utcNow(): Date;
  monotonicNow(): number;
}

export const systemClock: Clock = {
  utcNow: () => new Date(),
  monotonicNow: () => performance.now(),
};

export function isoNow(clock: Clock): string {
  return clock.utcNow().toISOString();
}

