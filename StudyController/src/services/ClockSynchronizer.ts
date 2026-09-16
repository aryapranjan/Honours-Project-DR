export interface ClockSample {
  serverSendMs: number;
  clientReceiveMs: number;
  clientSendMs: number;
  serverReceiveMs: number;
}

export interface ClockEstimate {
  offsetMs: number;
  roundTripMs: number;
  sampleCount: number;
}

interface ComputedSample {
  offsetMs: number;
  roundTripMs: number;
}

export class ClockSynchronizer {
  private readonly samples = new Map<string, ComputedSample[]>();

  public constructor(private readonly maxSamples = 12) {}

  public record(deviceId: string, sample: ClockSample): ClockEstimate {
    const roundTripMs =
      sample.serverReceiveMs -
      sample.serverSendMs -
      (sample.clientSendMs - sample.clientReceiveMs);
    const offsetMs =
      (sample.clientReceiveMs -
        sample.serverSendMs +
        sample.clientSendMs -
        sample.serverReceiveMs) /
      2;

    if (!Number.isFinite(roundTripMs) || roundTripMs < 0) {
      throw new Error("Clock sample produced an invalid round-trip time.");
    }

    const deviceSamples = this.samples.get(deviceId) ?? [];
    deviceSamples.push({ offsetMs, roundTripMs });
    if (deviceSamples.length > this.maxSamples) {
      deviceSamples.splice(0, deviceSamples.length - this.maxSamples);
    }
    this.samples.set(deviceId, deviceSamples);
    return this.estimate(deviceId)!;
  }

  public estimate(deviceId: string): ClockEstimate | null {
    const deviceSamples = this.samples.get(deviceId);
    if (deviceSamples === undefined || deviceSamples.length === 0) {
      return null;
    }

    const best = [...deviceSamples].sort(
      (left, right) => left.roundTripMs - right.roundTripMs,
    )[0]!;
    return {
      offsetMs: best.offsetMs,
      roundTripMs: best.roundTripMs,
      sampleCount: deviceSamples.length,
    };
  }
}

