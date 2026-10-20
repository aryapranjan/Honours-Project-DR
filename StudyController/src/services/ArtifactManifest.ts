import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { MediaArtifact } from "./ObsMediaController.js";
import { writeJsonAtomic } from "./SnapshotManager.js";

export interface ArtifactManifestEntry {
  relativePath: string;
  bytes: number;
  sha256: string;
  kind: "CONFIG" | "SCHEDULE" | "POLICY" | "EVENTS" | "CSV" | "MEDIA";
  trialId: string | null;
}

export interface ArtifactManifestReport {
  schemaVersion: "1.0.0";
  generatedAtUtc: string;
  mediaRequired: boolean;
  workflowPolicy: "RECORDED" | "LEGACY_UNRECORDED";
  entries: ArtifactManifestEntry[];
  missingTrialMedia: string[];
  issues: string[];
}

const CORE_FILES = [
  ["session-config.json", "CONFIG"],
  ["schedule.json", "SCHEDULE"],
  ["workflow-policy.json", "POLICY"],
  ["authoritative-events.jsonl", "EVENTS"],
  ["trial-summary.csv", "CSV"],
] as const;

export async function writeArtifactManifest(
  sessionDirectory: string,
  mediaRequired: boolean,
  startedTrialIds: readonly string[],
  mediaArtifacts: readonly MediaArtifact[],
  legacyWorkflowPolicy = false,
): Promise<ArtifactManifestReport> {
  const issues: string[] = [];
  const entries: ArtifactManifestEntry[] = [];
  const missingTrialMedia = mediaRequired
    ? startedTrialIds.filter(
        (trialId) => !mediaArtifacts.some((artifact) => artifact.trialId === trialId),
      )
    : [];
  for (const trialId of missingTrialMedia) {
    issues.push(`Started trial ${trialId} has no OBS media artifact.`);
  }
  for (const [relativePath, kind] of CORE_FILES) {
    if (relativePath === "workflow-policy.json" && legacyWorkflowPolicy) continue;
    try {
      entries.push(await hashFile(sessionDirectory, relativePath, kind, null));
    } catch (error) {
      issues.push(`Missing or unreadable ${relativePath}: ${String(error)}`);
    }
  }
  for (const artifact of mediaArtifacts) {
    if (!/^media\/[A-Za-z0-9_-]+\.mkv$/.test(artifact.relativePath)) {
      issues.push(`Media path for ${artifact.trialId} is outside the session media directory.`);
      continue;
    }
    try {
      const entry = await hashFile(
        sessionDirectory,
        artifact.relativePath,
        "MEDIA",
        artifact.trialId,
      );
      entries.push(entry);
      if (entry.sha256 !== artifact.sha256 || entry.bytes !== artifact.bytes) {
        issues.push(`OBS media checksum or size changed for ${artifact.trialId}.`);
      }
    } catch (error) {
      issues.push(`Missing or unreadable OBS media for ${artifact.trialId}: ${String(error)}`);
    }
  }
  const manifest: ArtifactManifestReport = {
    schemaVersion: "1.0.0",
    generatedAtUtc: new Date().toISOString(),
    mediaRequired,
    workflowPolicy: legacyWorkflowPolicy ? "LEGACY_UNRECORDED" : "RECORDED",
    entries,
    missingTrialMedia,
    issues,
  };
  await writeJsonAtomic(path.join(sessionDirectory, "artifact-manifest.json"), manifest);
  const saved = JSON.parse(
    await readFile(path.join(sessionDirectory, "artifact-manifest.json"), "utf8"),
  ) as ArtifactManifestReport;
  if (saved.entries.length !== entries.length) {
    throw new Error("Artifact manifest write verification failed.");
  }
  return manifest;
}

async function hashFile(
  sessionDirectory: string,
  relativePath: string,
  kind: ArtifactManifestEntry["kind"],
  trialId: string | null,
): Promise<ArtifactManifestEntry> {
  const fullPath = path.join(sessionDirectory, relativePath);
  const fileStat = await lstat(fullPath);
  if (!fileStat.isFile()) throw new Error("Artifact is not a regular file.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(fullPath)) hash.update(chunk);
  return {
    relativePath,
    bytes: fileStat.size,
    sha256: hash.digest("hex"),
    kind,
    trialId,
  };
}
