import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import {
  PAIRING_CODE_TTL_MS,
  type DeviceAssignment,
  type EnrollmentRequest,
  type PairingCodeView,
  type QuestDeviceId,
  type SessionConfig,
} from "../contracts.js";
import { areProtocolVersionsCompatible } from "../protocolRules.js";

interface PendingCode {
  code: string;
  expiresAtMonotonicMs: number;
}

export interface EnrollmentIdentity {
  deviceId: QuestDeviceId;
  participantId: string;
  role: DeviceAssignment["role"];
  clientInstanceId: string;
  protocolVersion: string;
  appBuildId: string;
  simulation: boolean;
}

interface StoredEnrollment extends EnrollmentIdentity {
  tokenHash: Buffer;
}

export interface EnrollmentStatus {
  deviceId: QuestDeviceId;
  paired: boolean;
  clientInstanceId: string | null;
  protocolVersion: string | null;
  appBuildId: string | null;
  simulation: boolean;
  pairingCodeExpiresAtUtc: string | null;
}

export interface IssuedEnrollment {
  identity: EnrollmentIdentity;
  accessToken: string;
}

export class EnrollmentManager {
  private config: SessionConfig | null = null;
  private readonly pendingCodes = new Map<QuestDeviceId, PendingCode>();
  private readonly enrollments = new Map<QuestDeviceId, StoredEnrollment>();

  public constructor(
    private readonly clock: Clock = systemClock,
    private readonly codeTtlMs = PAIRING_CODE_TTL_MS,
  ) {}

  public configure(config: SessionConfig): void {
    this.config = config;
    this.pendingCodes.clear();
    this.enrollments.clear();
  }

  public issuePairingCode(deviceId: QuestDeviceId): PairingCodeView {
    this.requireConfig();
    this.requireAssignment(deviceId);
    if (this.enrollments.has(deviceId)) {
      throw new Error(`${deviceId} is already enrolled.`);
    }

    let code: string;
    do {
      code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    } while ([...this.pendingCodes.values()].some((entry) => entry.code === code));

    const expiresAtMonotonicMs = this.clock.monotonicNow() + this.codeTtlMs;
    this.pendingCodes.set(deviceId, { code, expiresAtMonotonicMs });
    return {
      deviceId,
      code,
      expiresAtUtc: new Date(
        this.clock.utcNow().getTime() + this.codeTtlMs,
      ).toISOString(),
    };
  }

  public redeem(request: EnrollmentRequest): IssuedEnrollment {
    const config = this.requireConfig();
    if (!/^\d{6}$/.test(request.pairingCode)) {
      throw new Error("Pairing code must contain exactly six digits.");
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(request.clientInstanceId)) {
      throw new Error("Client instance ID is invalid.");
    }
    if (!areProtocolVersionsCompatible(config.protocolVersion, request.protocolVersion)) {
      throw new Error(
        `Quest protocol ${request.protocolVersion} is incompatible with ${config.protocolVersion}.`,
      );
    }
    if (request.appBuildId !== config.approvedQuestBuildId) {
      throw new Error(
        `Quest build ${request.appBuildId} is not the approved build ${config.approvedQuestBuildId}.`,
      );
    }

    const match = [...this.pendingCodes.entries()].find(
      ([, entry]) => entry.code === request.pairingCode,
    );
    if (match === undefined) {
      throw new Error("Pairing code is invalid or has already been used.");
    }
    const [deviceId, pending] = match;
    if (this.clock.monotonicNow() > pending.expiresAtMonotonicMs) {
      this.pendingCodes.delete(deviceId);
      throw new Error("Pairing code has expired.");
    }
    if (this.enrollments.has(deviceId)) {
      this.pendingCodes.delete(deviceId);
      throw new Error(`${deviceId} is already enrolled.`);
    }

    this.pendingCodes.delete(deviceId);
    return this.createEnrollment(
      deviceId,
      request.clientInstanceId,
      request.protocolVersion,
      request.appBuildId,
      false,
    );
  }

  public enrollSimulation(deviceId: QuestDeviceId): IssuedEnrollment {
    const config = this.requireConfig();
    if (this.enrollments.has(deviceId)) {
      throw new Error(`${deviceId} is already enrolled.`);
    }
    this.pendingCodes.delete(deviceId);
    return this.createEnrollment(
      deviceId,
      `phase4-simulator-${deviceId.toLowerCase()}`,
      config.protocolVersion,
      config.approvedQuestBuildId,
      true,
    );
  }

  public releaseSimulation(deviceId: QuestDeviceId): void {
    if (this.enrollments.get(deviceId)?.simulation === true) {
      this.enrollments.delete(deviceId);
    }
  }

  public authenticate(accessToken: string): EnrollmentIdentity {
    const presented = createHash("sha256").update(accessToken).digest();
    for (const enrollment of this.enrollments.values()) {
      if (
        presented.length === enrollment.tokenHash.length &&
        timingSafeEqual(presented, enrollment.tokenHash)
      ) {
        const { tokenHash: _tokenHash, ...identity } = enrollment;
        return { ...identity };
      }
    }
    throw new Error("Quest bearer token is invalid.");
  }

  public list(): EnrollmentStatus[] {
    const now = this.clock.monotonicNow();
    return this.requireConfig().deviceAssignments.map(({ deviceId }) => {
      const enrollment = this.enrollments.get(deviceId);
      const pending = this.pendingCodes.get(deviceId);
      return {
        deviceId,
        paired: enrollment !== undefined,
        clientInstanceId: enrollment?.clientInstanceId ?? null,
        protocolVersion: enrollment?.protocolVersion ?? null,
        appBuildId: enrollment?.appBuildId ?? null,
        simulation: enrollment?.simulation ?? false,
        pairingCodeExpiresAtUtc:
          pending === undefined || pending.expiresAtMonotonicMs < now
            ? null
            : new Date(
                this.clock.utcNow().getTime() +
                  (pending.expiresAtMonotonicMs - now),
              ).toISOString(),
      };
    });
  }

  private createEnrollment(
    deviceId: QuestDeviceId,
    clientInstanceId: string,
    protocolVersion: string,
    appBuildId: string,
    simulation: boolean,
  ): IssuedEnrollment {
    const assignment = this.requireAssignment(deviceId);
    const accessToken = randomBytes(32).toString("base64url");
    const identity: EnrollmentIdentity = {
      deviceId,
      participantId: assignment.participantId,
      role: assignment.role,
      clientInstanceId,
      protocolVersion,
      appBuildId,
      simulation,
    };
    this.enrollments.set(deviceId, {
      ...identity,
      tokenHash: createHash("sha256").update(accessToken).digest(),
    });
    return { identity, accessToken };
  }

  private requireAssignment(deviceId: QuestDeviceId): DeviceAssignment {
    const assignment = this.requireConfig().deviceAssignments.find(
      (candidate) => candidate.deviceId === deviceId,
    );
    if (assignment === undefined) {
      throw new Error(`Unknown Quest slot: ${deviceId}.`);
    }
    return assignment;
  }

  private requireConfig(): SessionConfig {
    if (this.config === null) {
      throw new Error("No active session is available for enrollment.");
    }
    return this.config;
  }
}
