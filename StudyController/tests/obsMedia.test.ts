import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { ObsMediaController } from "../src/services/ObsMediaController.js";
import { writeArtifactManifest } from "../src/services/ArtifactManifest.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("checks camera and isolated microphone levels, then saves a pseudonymous MKV with a checksum", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cdr-obs-"));
  const sessionDirectory = path.join(root, "PAIR-001");
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const sockets = new Set<WebSocket>();
  cleanup.push(async () => {
    for (const socket of sockets) socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  let peakA = -18;
  let peakB = -20;
  let stereoChannels = 2;
  let recording = false;
  let recordDirectory = root;
  const password = "test-password";
  const salt = "test-salt";
  const challenge = "test-challenge";
  let authenticated = false;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ op: 0, d: {
      rpcVersion: 1,
      authentication: { salt, challenge },
    } }));
    const meter = setInterval(() => {
      if (authenticated && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 5, d: {
          eventType: "InputVolumeMeters",
          eventData: { inputs: [
            { inputName: "Participant A Mic", inputLevelsDbfs: [[peakA]] },
            { inputName: "Participant B Mic", inputLevelsDbfs: [[peakB]] },
            { inputName: "Participant Receiver",
              inputLevelsDbfs: stereoChannels === 2 ? [[peakA], [peakB]] : [[peakA]] },
          ] },
        } }));
      }
    }, 20);
    socket.on("close", () => {
      clearInterval(meter);
      sockets.delete(socket);
    });
    socket.on("message", (raw) => {
      const packet = JSON.parse(raw.toString()) as {
        op: number;
        d: Record<string, unknown>;
      };
      if (packet.op === 1) {
        const secret = createHash("sha256").update(password + salt).digest("base64");
        const expected = createHash("sha256").update(secret + challenge).digest("base64");
        authenticated = packet.d.authentication === expected;
        if (authenticated) socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (packet.op !== 6 || !authenticated) return;
      const requestType = String(packet.d.requestType);
      const data = (packet.d.requestData ?? {}) as Record<string, unknown>;
      void (async () => {
        let responseData: Record<string, unknown> = {};
        switch (requestType) {
          case "GetVersion":
            responseData = { availableRequests: ["SetRecordDirectory"] };
            break;
          case "GetRecordStatus":
            responseData = { outputActive: recording };
            break;
          case "GetInputList":
            responseData = { inputs: [
              { inputName: "Overhead Camera" },
              { inputName: "Participant A Mic" },
              { inputName: "Participant B Mic" },
              { inputName: "Participant Receiver" },
            ] };
            break;
          case "GetSourceActive":
            responseData = { videoActive: true, videoShowing: true };
            break;
          case "GetSourceScreenshot":
            responseData = { imageData: "data:image/jpeg;base64,AAAA" };
            break;
          case "GetInputMute":
            responseData = { inputMuted: false };
            break;
          case "GetInputAudioTracks":
            responseData = { inputAudioTracks: data.inputName === "Participant Receiver"
              ? { "2": true, "3": false }
              : data.inputName === "Participant A Mic"
              ? { "2": true, "3": false } : { "2": false, "3": true } };
            break;
          case "SetRecordDirectory":
            recordDirectory = String(data.recordDirectory);
            break;
          case "GetRecordDirectory":
            responseData = { recordDirectory };
            break;
          case "StartRecord":
            recording = true;
            break;
          case "StopRecord": {
            recording = false;
            const outputPath = path.join(recordDirectory, "OBS 2026-10-06.mkv");
            await writeFile(outputPath, "mock recording bytes");
            responseData = { outputPath };
            break;
          }
          default:
            throw new Error(`Unexpected OBS request: ${requestType}`);
        }
        socket.send(JSON.stringify({ op: 7, d: {
          requestType,
          requestId: packet.d.requestId,
          requestStatus: { result: true, code: 100 },
          responseData,
        } }));
      })();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test OBS port.");
  const controller = new ObsMediaController({
    url: `ws://127.0.0.1:${address.port}`,
    password,
    cameraSource: "Overhead Camera",
    audioMode: "SEPARATE_INPUTS",
    microphoneA: "Participant A Mic",
    microphoneB: "Participant B Mic",
    microphoneATrack: 2,
    microphoneBTrack: 3,
    minimumFreeBytes: 0,
    meterSampleMs: 100,
  });
  cleanup.push(() => controller.close());

  expect((await controller.inspect(sessionDirectory)).ready).toBe(true);
  const storageFaultController = new ObsMediaController({
    url: `ws://127.0.0.1:${address.port}`,
    password,
    cameraSource: "Overhead Camera",
    audioMode: "SEPARATE_INPUTS",
    microphoneA: "Participant A Mic",
    microphoneB: "Participant B Mic",
    microphoneATrack: 2,
    microphoneBTrack: 3,
    minimumFreeBytes: Number.MAX_SAFE_INTEGER,
    meterSampleMs: 50,
  });
  cleanup.push(() => storageFaultController.close());
  const storageFault = await storageFaultController.inspect(sessionDirectory);
  expect(storageFault.ready).toBe(false);
  expect(storageFault.storageReady).toBe(false);
  expect(storageFault.issues.join(" ")).toContain("free-space minimum");
  const stereoController = new ObsMediaController({
    url: `ws://127.0.0.1:${address.port}`,
    password,
    cameraSource: "Overhead Camera",
    audioMode: "STEREO_RECEIVER",
    receiverInput: "Participant Receiver",
    receiverTrack: 2,
    participantAChannel: "LEFT",
    participantBChannel: "RIGHT",
    minimumFreeBytes: 0,
    meterSampleMs: 100,
  });
  cleanup.push(() => stereoController.close());
  const stereoReady = await stereoController.inspect(sessionDirectory);
  expect(stereoReady.ready).toBe(true);
  expect(stereoReady.microphones.map((mic) => [mic.participant, mic.channel, mic.peakDbfs, mic.track]))
    .toEqual([["A", "LEFT", -18, 2], ["B", "RIGHT", -20, 2]]);
  peakB = -0.2;
  expect((await controller.inspect(sessionDirectory)).issues.join(" ")).toContain("clipping");
  expect((await stereoController.inspect(sessionDirectory)).issues.join(" "))
    .toContain("Participant B (Participant Receiver right) is clipping");
  peakB = -60;
  expect((await controller.inspect(sessionDirectory)).issues.join(" ")).toContain("silent");
  expect((await stereoController.inspect(sessionDirectory)).issues.join(" "))
    .toContain("Participant B (Participant Receiver right) is silent");
  peakB = -20;
  stereoChannels = 1;
  const monoFault = await stereoController.inspect(sessionDirectory);
  expect(monoFault.ready).toBe(false);
  expect(monoFault.issues.join(" ")).toContain("no right channel; set the receiver to stereo output");
  stereoChannels = 2;
  await controller.start("SCORED-01", sessionDirectory);
  const artifact = await controller.stop("SCORED-01");
  expect(artifact.relativePath).toBe("media/PAIR-001_SCORED-01.mkv");
  const bytes = await readFile(path.join(sessionDirectory, artifact.relativePath));
  expect(artifact.bytes).toBe(bytes.length);
  expect(artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  await controller.start("SCORED-02", sessionDirectory);
  await controller.close();
  const restartedController = new ObsMediaController({
    url: `ws://127.0.0.1:${address.port}`,
    password,
    cameraSource: "Overhead Camera",
    audioMode: "SEPARATE_INPUTS",
    microphoneA: "Participant A Mic",
    microphoneB: "Participant B Mic",
    microphoneATrack: 2,
    microphoneBTrack: 3,
    minimumFreeBytes: 0,
    meterSampleMs: 50,
  });
  cleanup.push(() => restartedController.close());
  const recoveredArtifact = await restartedController.recover("SCORED-02", sessionDirectory);
  expect(recoveredArtifact.relativePath).toBe("media/PAIR-001_SCORED-02.mkv");
  for (const filename of [
    "session-config.json",
    "schedule.json",
    "workflow-policy.json",
    "authoritative-events.jsonl",
    "trial-summary.csv",
  ]) {
    await writeFile(path.join(sessionDirectory, filename), filename);
  }
  const validManifest = await writeArtifactManifest(
    sessionDirectory,
    true,
    ["SCORED-01", "SCORED-02"],
    [artifact, recoveredArtifact],
  );
  expect(validManifest.issues).toEqual([]);
  expect(validManifest.entries).toHaveLength(7);
  await writeFile(path.join(sessionDirectory, artifact.relativePath), "tampered media");
  const invalidManifest = await writeArtifactManifest(
    sessionDirectory,
    true,
    ["SCORED-01", "SCORED-02", "SCORED-03"],
    [artifact, recoveredArtifact],
  );
  expect(invalidManifest.issues.join(" ")).toContain("SCORED-03 has no OBS media");
  expect(invalidManifest.issues.join(" ")).toContain("checksum or size changed");
});
