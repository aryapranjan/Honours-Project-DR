import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type { TimerView } from "../runtimeTypes.js";

export class AuthoritativeTimer {
  private thresholdTimeout: NodeJS.Timeout | null = null;
  private startedAtMonotonicMs: number | null = null;
  private timeLimitMs = 0;
  private stoppedElapsedMs = 0;
  private running = false;
  private onTimeLimitReached: (() => void | Promise<void>) | null = null;

  public constructor(private readonly clock: Clock = systemClock) {}

  public start(
    timeLimitMs: number,
    onTimeLimitReached: () => void | Promise<void>,
  ): void {
    if (this.running || this.startedAtMonotonicMs !== null) {
      throw new Error("Authoritative stopwatch is already running.");
    }
    if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0) {
      throw new Error("Stopwatch time limit must be a positive number.");
    }

    this.timeLimitMs = timeLimitMs;
    this.stoppedElapsedMs = 0;
    this.startedAtMonotonicMs = this.clock.monotonicNow();
    this.running = true;
    this.onTimeLimitReached = onTimeLimitReached;
    this.thresholdTimeout = setTimeout(() => {
      this.thresholdTimeout = null;
      const callback = this.onTimeLimitReached;
      this.onTimeLimitReached = null;
      if (callback !== null) {
        void callback();
      }
    }, timeLimitMs);
  }

  public stop(): TimerView {
    const view = this.view();
    if (this.thresholdTimeout !== null) {
      clearTimeout(this.thresholdTimeout);
    }
    this.thresholdTimeout = null;
    this.running = false;
    this.startedAtMonotonicMs = null;
    this.stoppedElapsedMs = view.elapsedMs;
    this.onTimeLimitReached = null;
    return { ...view, running: false };
  }

  public reset(): void {
    this.stop();
    this.timeLimitMs = 0;
    this.stoppedElapsedMs = 0;
  }

  public view(): TimerView {
    const elapsedMs = Math.max(
      0,
      this.running && this.startedAtMonotonicMs !== null
        ? this.clock.monotonicNow() - this.startedAtMonotonicMs
        : this.stoppedElapsedMs,
    );
    const roundedElapsedMs = Math.round(elapsedMs);
    const limitReached =
      this.timeLimitMs > 0 && roundedElapsedMs >= this.timeLimitMs;
    return {
      running: this.running,
      timeLimitMs: this.timeLimitMs,
      elapsedMs: roundedElapsedMs,
      limitReached,
      overrunMs: limitReached
        ? Math.max(0, roundedElapsedMs - this.timeLimitMs)
        : 0,
    };
  }

  public isRunning(): boolean {
    return this.running;
  }
}
