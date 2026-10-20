import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, realpath, statfs, unlink } from "node:fs/promises";
import path from "node:path";

import WebSocket from "ws";

interface ObsMediaBaseOptions {
  url: string;
  password: string;
  cameraSource: string;
  minimumFreeBytes?: number;
  meterSampleMs?: number;
}

export type ObsMediaOptions = ObsMediaBaseOptions & (
  | {
      audioMode: "STEREO_RECEIVER";
      receiverInput: string;
      receiverTrack: number;
      participantAChannel: "LEFT" | "RIGHT";
      participantBChannel: "LEFT" | "RIGHT";
    }
  | {
      audioMode: "SEPARATE_INPUTS";
      microphoneA: string;
      microphoneB: string;
      microphoneATrack: number;
      microphoneBTrack: number;
    }
);

export interface MicrophoneReadiness {
  participant: "A" | "B";
  inputName: string;
  channel: "LEFT" | "RIGHT" | null;
  track: number;
  peakDbfs: number | null;
  sampleCount: number;
  muted: boolean;
  issue: string | null;
}

export interface MediaReadiness {
  mode: "OBS";
  checkedAtUtc: string;
  ready: boolean;
  cameraSource: string;
  cameraActive: boolean;
  microphones: MicrophoneReadiness[];
  availableBytes: number;
  storageReady: boolean;
  recordDirectory: string;
  issues: string[];
}

export interface MediaArtifact {
  trialId: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  recordedAtUtc: string;
}

export interface MediaCapture {
  inspect(sessionDirectory: string): Promise<MediaReadiness>;
  cameraPreview(): Promise<string>;
  start(trialId: string, sessionDirectory: string): Promise<void>;
  stop(trialId: string): Promise<MediaArtifact>;
  recover(trialId: string, sessionDirectory: string): Promise<MediaArtifact>;
  isRecordingTrial(trialId: string): boolean;
  close(): Promise<void>;
}

type ObsPacket = { op: number; d: Record<string, unknown> };
type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

// OBS WebSocket v5 uses request IDs and an Identify handshake. The password is
// kept in process memory and never included in the authoritative event log.
export class ObsMediaController implements MediaCapture {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly meters = new Map<string, { channelPeakDbfs: number[]; samples: number }>();
  private activeTrial: { trialId: string; mediaDirectory: string } | null = null;

  public constructor(private readonly options: ObsMediaOptions) {
    if (!/^wss?:\/\//.test(options.url)) {
      throw new Error("OBS_URL must be a ws:// or wss:// URL.");
    }
    if (!options.cameraSource) throw new Error("OBS requires a camera source name.");
    if (options.audioMode === "STEREO_RECEIVER") {
      if (!options.receiverInput) throw new Error("OBS requires a stereo receiver source name.");
      if (options.participantAChannel === options.participantBChannel) {
        throw new Error("Participants A and B must use different receiver channels.");
      }
    } else if (!options.microphoneA || !options.microphoneB ||
        options.microphoneA === options.microphoneB) {
      throw new Error("OBS requires two distinct microphone source names.");
    }
    const tracks = options.audioMode === "STEREO_RECEIVER"
      ? [options.receiverTrack]
      : [options.microphoneATrack, options.microphoneBTrack];
    for (const track of tracks) {
      if (!Number.isInteger(track) || track < 1 || track > 6) {
        throw new Error("OBS microphone track numbers must be between 1 and 6.");
      }
    }
    if (options.audioMode === "SEPARATE_INPUTS" &&
        options.microphoneATrack === options.microphoneBTrack) {
      throw new Error("The two participant microphones need distinct OBS tracks.");
    }
  }

  public async inspect(sessionDirectory: string): Promise<MediaReadiness> {
    const mediaDirectory = path.join(sessionDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    const issues: string[] = [];
    const disk = await statfs(mediaDirectory);
    const availableBytes = disk.bavail * disk.bsize;
    const storageReady = availableBytes >= (this.options.minimumFreeBytes ?? 2 * 1024 ** 3);
    if (!storageReady) {
      issues.push("Capture storage has less than the configured free-space minimum.");
    }

    const version = await this.request("GetVersion");
    if (!((version.availableRequests as string[] | undefined) ?? []).includes("SetRecordDirectory")) {
      issues.push("OBS WebSocket must support SetRecordDirectory (v5.3 or newer).");
    }

    const record = await this.request("GetRecordStatus");
    if (record.outputActive === true) {
      issues.push("OBS is already recording outside the current trial.");
    }
    const inputs = await this.request("GetInputList");
    const names = new Set(
      ((inputs.inputs as Array<{ inputName: string }> | undefined) ?? [])
        .map(({ inputName }) => inputName),
    );
    if (!names.has(this.options.cameraSource)) {
      issues.push(`OBS camera source ${this.options.cameraSource} is missing.`);
    }
    let cameraActive = false;
    if (names.has(this.options.cameraSource)) {
      const active = await this.request("GetSourceActive", {
        sourceName: this.options.cameraSource,
      });
      cameraActive = active.videoActive === true;
      if (!cameraActive) {
        issues.push(`OBS camera source ${this.options.cameraSource} is inactive.`);
      } else {
        try {
          await this.cameraPreview();
        } catch (error) {
          issues.push(`OBS camera preview failed: ${message(error)}`);
        }
      }
    }

    this.meters.clear();
    await new Promise((resolve) =>
      setTimeout(resolve, this.options.meterSampleMs ?? 1_500),
    );
    const microphones: MicrophoneReadiness[] = [];
    const trackAssignments = new Map<string, Record<string, boolean>>();
    const assignments: Array<{
      participant: "A" | "B";
      inputName: string;
      track: number;
      channel: "LEFT" | "RIGHT" | null;
    }> = this.options.audioMode === "STEREO_RECEIVER"
      ? [
          { participant: "A", inputName: this.options.receiverInput,
            track: this.options.receiverTrack, channel: this.options.participantAChannel },
          { participant: "B", inputName: this.options.receiverInput,
            track: this.options.receiverTrack, channel: this.options.participantBChannel },
        ]
      : [
          { participant: "A", inputName: this.options.microphoneA,
            track: this.options.microphoneATrack, channel: null },
          { participant: "B", inputName: this.options.microphoneB,
            track: this.options.microphoneBTrack, channel: null },
        ];
    const inputChecks = new Map<string, { muted: boolean; routing: Record<string, boolean> }>();
    for (const { participant, inputName, track, channel } of assignments) {
      let muted = false;
      let issue: string | null = null;
      if (!names.has(inputName)) {
        issue = `OBS microphone ${inputName} is missing.`;
      } else {
        let check = inputChecks.get(inputName);
        if (check === undefined) {
          const [mute, tracks] = await Promise.all([
            this.request("GetInputMute", { inputName }),
            this.request("GetInputAudioTracks", { inputName }),
          ]);
          check = {
            muted: mute.inputMuted === true,
            routing: (tracks.inputAudioTracks as Record<string, boolean> | undefined) ?? {},
          };
          inputChecks.set(inputName, check);
        }
        muted = check.muted;
        const routing = check.routing;
        trackAssignments.set(inputName, routing);
        const routed = routing[String(track)] === true;
        if (muted) {
          issue = `${inputName} is muted in OBS.`;
        } else if (!routed) {
          issue = `${inputName} is not routed to its assigned OBS track ${track}.`;
        }
      }
      const meter = this.meters.get(inputName);
      const channelIndex = channel === "LEFT" ? 0 : channel === "RIGHT" ? 1 : null;
      const peak = channelIndex === null
        ? Math.max(...(meter?.channelPeakDbfs ?? []))
        : meter?.channelPeakDbfs[channelIndex];
      const peakDbfs = peak !== undefined && Number.isFinite(peak) ? peak : null;
      if (issue === null && peakDbfs === null) {
        issue = channel !== null && (meter?.samples ?? 0) > 0
          ? `${inputName} has no ${channel.toLowerCase()} channel; set the receiver to stereo output and retry.`
          : `${inputName} has no live audio meter samples.`;
      } else if (issue === null && peakDbfs! < -45) {
        issue = `Participant ${participant} (${inputName}${channel === null ? "" : ` ${channel.toLowerCase()}`}) is silent or too quiet; ask them to speak and retry.`;
      } else if (issue === null && peakDbfs! >= -1) {
        issue = `Participant ${participant} (${inputName}${channel === null ? "" : ` ${channel.toLowerCase()}`}) is clipping; lower gain and retry.`;
      }
      if (issue !== null) issues.push(issue);
      microphones.push({
        participant,
        inputName,
        channel,
        track,
        peakDbfs,
        sampleCount: meter?.samples ?? 0,
        muted,
        issue,
      });
    }
    if (this.options.audioMode === "SEPARATE_INPUTS") {
      const aTracks = trackAssignments.get(this.options.microphoneA);
      const bTracks = trackAssignments.get(this.options.microphoneB);
      if (aTracks?.[String(this.options.microphoneBTrack)] === true ||
          bTracks?.[String(this.options.microphoneATrack)] === true) {
        issues.push("Participant microphones overlap on their assigned isolated OBS tracks.");
      }
    }
    return {
      mode: "OBS",
      checkedAtUtc: new Date().toISOString(),
      ready: issues.length === 0,
      cameraSource: this.options.cameraSource,
      cameraActive,
      microphones,
      availableBytes,
      storageReady,
      recordDirectory: mediaDirectory,
      issues,
    };
  }

  public async cameraPreview(): Promise<string> {
    const response = await this.request("GetSourceScreenshot", {
      sourceName: this.options.cameraSource,
      imageFormat: "jpg",
      imageWidth: 640,
    });
    const imageData = response.imageData;
    if (typeof imageData !== "string" || !/^data:image\/(jpeg|jpg);base64,/.test(imageData)) {
      throw new Error("OBS did not return a JPEG preview.");
    }
    return imageData;
  }

  public async start(trialId: string, sessionDirectory: string): Promise<void> {
    if (this.activeTrial !== null) {
      throw new Error(`OBS already has recording trial ${this.activeTrial.trialId}.`);
    }
    const mediaDirectory = path.join(sessionDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    const status = await this.request("GetRecordStatus");
    if (status.outputActive === true) {
      throw new Error("OBS is already recording.");
    }
    await this.request("SetRecordDirectory", { recordDirectory: mediaDirectory });
    const directory = await this.request("GetRecordDirectory");
    if (path.resolve(String(directory.recordDirectory)) !== path.resolve(mediaDirectory)) {
      throw new Error("OBS did not accept the session media directory.");
    }
    await this.request("StartRecord");
    this.activeTrial = { trialId, mediaDirectory };
    const started = await this.request("GetRecordStatus");
    if (started.outputActive !== true) {
      throw new Error("OBS did not enter the recording state.");
    }
  }

  public isRecordingTrial(trialId: string): boolean {
    return this.activeTrial?.trialId === trialId;
  }

  public async recover(trialId: string, sessionDirectory: string): Promise<MediaArtifact> {
    const mediaDirectory = path.join(sessionDirectory, "media");
    if (this.activeTrial !== null && this.activeTrial.trialId !== trialId) {
      throw new Error(`OBS is tracking ${this.activeTrial.trialId}, not ${trialId}.`);
    }
    const status = await this.request("GetRecordStatus");
    if (status.outputActive !== true) {
      throw new Error("OBS is no longer recording; inspect the output directory manually.");
    }
    const directory = await this.request("GetRecordDirectory");
    if (path.resolve(String(directory.recordDirectory)) !== path.resolve(mediaDirectory)) {
      throw new Error("OBS recording directory differs from the active session.");
    }
    this.activeTrial = { trialId, mediaDirectory };
    return this.stop(trialId);
  }

  public async stop(trialId: string): Promise<MediaArtifact> {
    const active = this.activeTrial;
    if (active === null || active.trialId !== trialId) {
      throw new Error(`OBS has no active recording for ${trialId}.`);
    }
    const stopped = await this.request("StopRecord");
    this.activeTrial = null;
    const source = path.resolve(String(stopped.outputPath));
    if (path.dirname(source) !== path.resolve(active.mediaDirectory)) {
      throw new Error("OBS recording was saved outside the session media directory.");
    }
    if (path.extname(source).toLowerCase() !== ".mkv") {
      throw new Error("OBS recording must be MKV for the study workflow.");
    }
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.size === 0) {
      throw new Error("OBS output is missing or empty.");
    }
    if (path.dirname(await realpath(source)) !== await realpath(active.mediaDirectory)) {
      throw new Error("OBS output resolved outside the session media directory.");
    }
    const safeTrialId = trialId.replaceAll(/[^A-Za-z0-9_-]/g, "_");
    const destination = path.join(
      active.mediaDirectory,
      `${path.basename(path.dirname(active.mediaDirectory))}_${safeTrialId}.mkv`,
    );
    await link(source, destination); // Fails if a prior recording already owns this name.
    await unlink(source);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    const bytes = (await lstat(destination)).size;
    return {
      trialId,
      relativePath: path.join("media", path.basename(destination)),
      bytes,
      sha256: hash.digest("hex"),
      recordedAtUtc: new Date().toISOString(),
    };
  }

  public async close(): Promise<void> {
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
  }

  private async request(
    requestType: string,
    requestData: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.connect();
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error("OBS WebSocket is disconnected.");
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error(`OBS ${requestType} timed out.`));
      }, 5_000);
      this.requests.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData },
      }));
    });
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.connecting === null) return;
    if (this.connecting !== null) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("OBS WebSocket handshake timed out."));
      }, 5_000);
      socket.on("message", (raw) => {
        let packet: ObsPacket;
        try {
          packet = JSON.parse(raw.toString()) as ObsPacket;
        } catch {
          return;
        }
        if (packet.op === 0) {
          const auth = packet.d.authentication as
            | { challenge: string; salt: string }
            | undefined;
          let authentication: string | undefined;
          if (auth !== undefined) {
            const secret = createHash("sha256")
              .update(this.options.password + auth.salt).digest("base64");
            authentication = createHash("sha256")
              .update(secret + auth.challenge).digest("base64");
          }
          socket.send(JSON.stringify({
            op: 1,
            d: { rpcVersion: 1, eventSubscriptions: 1 << 16, ...(authentication === undefined ? {} : { authentication }) },
          }));
        } else if (packet.op === 2) {
          clearTimeout(timer);
          resolve();
        } else if (packet.op === 5 && packet.d.eventType === "InputVolumeMeters") {
          const data = packet.d.eventData as { inputs?: Array<{
            inputName: string;
            inputLevelsDbfs: number[][];
          }> } | undefined;
          for (const input of data?.inputs ?? []) {
            const prior = this.meters.get(input.inputName);
            const channelPeakDbfs = [...(prior?.channelPeakDbfs ?? [])];
            if (Array.isArray(input.inputLevelsDbfs)) {
              input.inputLevelsDbfs.forEach((levels, index) => {
                if (!Array.isArray(levels)) return;
                const finite = levels.filter((value) => typeof value === "number" && Number.isFinite(value));
                if (finite.length > 0) {
                  channelPeakDbfs[index] = Math.max(channelPeakDbfs[index] ?? -Infinity, ...finite);
                }
              });
            }
            this.meters.set(input.inputName, {
              channelPeakDbfs,
              samples: (prior?.samples ?? 0) + 1,
            });
          }
        } else if (packet.op === 7) {
          const requestId = String(packet.d.requestId);
          const pending = this.requests.get(requestId);
          if (pending === undefined) return;
          this.requests.delete(requestId);
          clearTimeout(pending.timer);
          const status = packet.d.requestStatus as
            | { result: boolean; comment?: string }
            | undefined;
          if (status?.result !== true) {
            pending.reject(new Error(`OBS ${String(packet.d.requestType)} failed: ${status?.comment ?? "unknown error"}`));
          } else {
            pending.resolve((packet.d.responseData as Record<string, unknown> | undefined) ?? {});
          }
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        for (const pending of this.requests.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("OBS WebSocket disconnected."));
        }
        this.requests.clear();
        reject(new Error("OBS WebSocket closed during handshake."));
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
