import type { QuestDeviceId } from "../contracts.js";
import { SimulatedQuestClient } from "./SimulatedQuestClient.js";

export class SimulationController {
  private readonly clients = new Map<string, SimulatedQuestClient>();

  public constructor(private readonly websocketBaseUrl: string) {}

  public async startSlot(
    deviceId: QuestDeviceId,
    accessToken: string,
    appBuildId: string,
  ): Promise<void> {
    if (this.clients.has(deviceId)) {
      throw new Error(`A simulator is already running for ${deviceId}.`);
    }
    const client = new SimulatedQuestClient(
      this.websocketBaseUrl,
      deviceId,
      accessToken,
      appBuildId,
    );
    this.clients.set(deviceId, client);
    try {
      await client.connect();
    } catch (error) {
      this.clients.delete(deviceId);
      throw error;
    }
  }

  public stop(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }

  public stopSlot(deviceId: QuestDeviceId): void {
    this.clients.get(deviceId)?.stop();
    this.clients.delete(deviceId);
  }

  public disconnect(deviceId: QuestDeviceId, durationMs: number): void {
    const client = this.clients.get(deviceId);
    if (client === undefined) {
      throw new Error(`No simulator is running for ${deviceId}.`);
    }
    client.disconnectFor(durationMs);
  }
}
