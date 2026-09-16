import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionSnapshot } from "../contracts.js";
import { assertSchema, SCHEMA_IDS } from "../validation.js";

interface ActiveSessionPointer {
  sessionId: string;
  pairId: string;
  relativeDirectory: string;
  closed: boolean;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export class SnapshotManager {
  public readonly snapshotsDirectory: string;

  public constructor(
    public readonly dataRoot: string,
    public readonly sessionDirectory: string,
  ) {
    this.snapshotsDirectory = path.join(sessionDirectory, "snapshots");
  }

  public async write(snapshot: SessionSnapshot): Promise<string> {
    assertSchema(SCHEMA_IDS.snapshot, snapshot);
    await mkdir(this.snapshotsDirectory, { recursive: true });
    const versionedName = `state-${String(snapshot.stateVersion).padStart(
      6,
      "0",
    )}.json`;
    await writeJsonAtomic(
      path.join(this.snapshotsDirectory, versionedName),
      snapshot,
    );
    await writeJsonAtomic(
      path.join(this.snapshotsDirectory, "latest.json"),
      snapshot,
    );
    return path.join("snapshots", versionedName);
  }

  public async loadLatest(): Promise<SessionSnapshot | null> {
    try {
      const snapshot = JSON.parse(
        await readFile(
          path.join(this.snapshotsDirectory, "latest.json"),
          "utf8",
        ),
      ) as SessionSnapshot;
      assertSchema(SCHEMA_IDS.snapshot, snapshot);
      return snapshot;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  public async writeActivePointer(pointer: ActiveSessionPointer): Promise<void> {
    await writeJsonAtomic(path.join(this.dataRoot, "active-session.json"), pointer);
  }

  public static async loadActivePointer(
    dataRoot: string,
  ): Promise<ActiveSessionPointer | null> {
    try {
      return JSON.parse(
        await readFile(path.join(dataRoot, "active-session.json"), "utf8"),
      ) as ActiveSessionPointer;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }
}

export { writeJsonAtomic };

