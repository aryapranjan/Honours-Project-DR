import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import type { Clock } from "../clock.js";
import { isoNow, systemClock } from "../clock.js";
import { SCHEMA_VERSION, type StudyEvent } from "../contracts.js";
import { assertSchema, SCHEMA_IDS } from "../validation.js";

export interface EventInput {
  trialId: string | null;
  stateVersion: number;
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
  correctsEventId?: string | null;
}

export class EventLogger {
  private sequence: number;
  private writeTail: Promise<unknown> = Promise.resolve();

  private constructor(
    public readonly filePath: string,
    private readonly sessionId: string,
    initialSequence: number,
    private readonly clock: Clock,
  ) {
    this.sequence = initialSequence;
  }

  public static async open(
    sessionDirectory: string,
    sessionId: string,
    clock: Clock = systemClock,
  ): Promise<EventLogger> {
    await mkdir(sessionDirectory, { recursive: true });
    const filePath = path.join(sessionDirectory, "authoritative-events.jsonl");
    let initialSequence = 0;

    try {
      const contents = await readFile(filePath, "utf8");
      const lines = contents
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const event = JSON.parse(line) as StudyEvent;
        assertSchema(SCHEMA_IDS.event, event);
        if (event.sessionId !== sessionId) {
          throw new Error("Event log contains a different session ID.");
        }
        if (event.sequence !== initialSequence + 1) {
          throw new Error("Event log sequence is not contiguous.");
        }
        initialSequence = event.sequence;
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }

    return new EventLogger(filePath, sessionId, initialSequence, clock);
  }

  public get lastSequence(): number {
    return this.sequence;
  }

  public append(input: EventInput): Promise<StudyEvent> {
    const operation = this.writeTail.then(async () => {
      const event: StudyEvent = {
        schemaVersion: SCHEMA_VERSION,
        eventId: randomUUID(),
        sequence: this.sequence + 1,
        sessionId: this.sessionId,
        trialId: input.trialId,
        stateVersion: input.stateVersion,
        recordedAtUtc: isoNow(this.clock),
        recordedAtMonotonicMs: this.clock.monotonicNow(),
        source: input.source,
        eventType: input.eventType,
        correctsEventId: input.correctsEventId ?? null,
        payload: input.payload,
      };
      assertSchema(SCHEMA_IDS.event, event);

      const handle = await open(this.filePath, "a");
      try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.sequence = event.sequence;
      return event;
    });

    this.writeTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public async readAll(): Promise<StudyEvent[]> {
    await this.writeTail;
    const contents = await readFile(this.filePath, "utf8");
    return contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StudyEvent);
  }
}

