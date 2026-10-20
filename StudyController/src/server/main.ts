import path from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

import { DEFAULT_APPROVED_QUEST_BUILD_ID } from "../contracts.js";
import { createStudyServer } from "./createStudyServer.js";
import type { ObsMediaOptions } from "../services/ObsMediaController.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../..");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4317");
const advertisedHost = process.env.ADVERTISED_HOST ?? detectAdvertisedHost();
const approvedQuestBuildId =
  process.env.APPROVED_QUEST_BUILD_ID ?? DEFAULT_APPROVED_QUEST_BUILD_ID;
const drPreviewEnabled = process.env.DR_PREVIEW_ENABLED === "true";
const questionnaireGateEnabled = process.env.QUESTIONNAIRE_GATE_ENABLED === "true";
const obsEnabled = process.env.OBS_ENABLED === "true";
const obsAudioMode = process.env.OBS_AUDIO_MODE ?? "STEREO_RECEIVER";
if (obsEnabled && obsAudioMode !== "STEREO_RECEIVER" && obsAudioMode !== "SEPARATE_INPUTS") {
  throw new Error("OBS_AUDIO_MODE must be STEREO_RECEIVER or SEPARATE_INPUTS.");
}
function receiverChannel(value: string | undefined, participant: "A" | "B"): "LEFT" | "RIGHT" {
  const channel = value ?? (participant === "A" ? "LEFT" : "RIGHT");
  if (channel !== "LEFT" && channel !== "RIGHT") {
    throw new Error(`OBS_PARTICIPANT_${participant}_CHANNEL must be LEFT or RIGHT.`);
  }
  return channel;
}
const obsBaseOptions = {
  url: process.env.OBS_URL ?? "ws://127.0.0.1:4455",
  password: process.env.OBS_PASSWORD ?? "",
  cameraSource: process.env.OBS_CAMERA_SOURCE ?? "Overhead Camera",
};
const obsOptions: ObsMediaOptions | undefined = !obsEnabled
  ? undefined
  : obsAudioMode === "STEREO_RECEIVER"
    ? {
        ...obsBaseOptions,
        audioMode: "STEREO_RECEIVER",
        receiverInput: process.env.OBS_RECEIVER_SOURCE ?? "Participant Receiver",
        receiverTrack: Number(process.env.OBS_RECEIVER_TRACK ?? "2"),
        participantAChannel: receiverChannel(process.env.OBS_PARTICIPANT_A_CHANNEL, "A"),
        participantBChannel: receiverChannel(process.env.OBS_PARTICIPANT_B_CHANNEL, "B"),
      }
    : {
        ...obsBaseOptions,
        audioMode: "SEPARATE_INPUTS",
        microphoneA: process.env.OBS_MIC_A_SOURCE ?? "Participant A Mic",
        microphoneB: process.env.OBS_MIC_B_SOURCE ?? "Participant B Mic",
        microphoneATrack: Number(process.env.OBS_MIC_A_TRACK ?? "2"),
        microphoneBTrack: Number(process.env.OBS_MIC_B_TRACK ?? "3"),
      };
const questionnaireUrls = {
  ...(process.env.FORM_PRE_STUDY_URL === undefined
    ? {}
    : { PRE_STUDY: process.env.FORM_PRE_STUDY_URL }),
  ...(process.env.FORM_POST_TRIAL_URL === undefined
    ? {}
    : { POST_TRIAL: process.env.FORM_POST_TRIAL_URL }),
  ...(process.env.FORM_POST_CONDITION_URL === undefined
    ? {}
    : { POST_CONDITION: process.env.FORM_POST_CONDITION_URL }),
  ...(process.env.FORM_POST_SESSION_URL === undefined
    ? {}
    : { POST_SESSION: process.env.FORM_POST_SESSION_URL }),
};
const dataRoot = path.resolve(
  process.env.STUDY_DATA_ROOT ?? path.join(projectRoot, ".study-data"),
);
const counterbalancePlanPath = path.resolve(
  process.env.COUNTERBALANCE_PLAN ??
    path.join(projectRoot, "examples/counterbalance-plan.example.json"),
);
const dashboardDistPath = path.resolve(
  process.env.DASHBOARD_DIST ??
    path.join(projectRoot, "dashboard/dist"),
);

const server = await createStudyServer({
  host,
  port,
  dataRoot,
  counterbalancePlanPath,
  dashboardDistPath,
  advertisedHost,
  approvedQuestBuildId,
  drPreviewEnabled,
  questionnaireGateEnabled,
  questionnaireUrls,
  ...(obsOptions === undefined ? {} : { obsOptions }),
});

console.log(
  `Collaborative DR Study Controller listening on http://${server.host}:${server.port}`,
);
console.log(`Study data root: ${dataRoot}`);
console.log(`Counterbalance plan: ${counterbalancePlanPath}`);
console.log(
  `Quest connection: ws://${advertisedHost}:${server.port}/ws?clientType=quest`,
);
console.log(`Approved Quest build: ${approvedQuestBuildId}`);
console.log(`Researcher DR preview: ${drPreviewEnabled ? "enabled" : "disabled"}`);
console.log(`OBS media control: ${obsEnabled ? "enabled" : "simulated"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}

function detectAdvertisedHost(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}
