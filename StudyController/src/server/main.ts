import path from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

import { DEFAULT_APPROVED_QUEST_BUILD_ID } from "../contracts.js";
import { createStudyServer } from "./createStudyServer.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../..");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4317");
const advertisedHost = process.env.ADVERTISED_HOST ?? detectAdvertisedHost();
const approvedQuestBuildId =
  process.env.APPROVED_QUEST_BUILD_ID ?? DEFAULT_APPROVED_QUEST_BUILD_ID;
const drPreviewEnabled = process.env.DR_PREVIEW_ENABLED === "true";
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
