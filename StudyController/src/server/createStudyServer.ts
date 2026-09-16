import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import WebSocket, { WebSocketServer } from "ws";

import type { Clock } from "../clock.js";
import type {
  EnrollmentRequest,
  QuestDeviceId,
} from "../contracts.js";
import type {
  GuardedActionInput,
  PreflightKey,
} from "../runtimeTypes.js";
import { SimulationController } from "../simulation/SimulationController.js";
import { StudySessionManager } from "../services/StudySessionManager.js";

export interface StudyServerOptions {
  host: string;
  port: number;
  dataRoot: string;
  counterbalancePlanPath: string;
  dashboardDistPath: string;
  clock?: Clock;
  startLeadMs?: number;
  advertisedHost?: string;
  approvedQuestBuildId?: string;
  pairingCodeTtlMs?: number;
  drPreviewEnabled?: boolean;
}

export interface RunningStudyServer {
  host: string;
  port: number;
  manager: StudySessionManager;
  close(): Promise<void>;
}

type AsyncRoute = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

function route(handler: AsyncRoute) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

export async function createStudyServer(
  options: StudyServerOptions,
): Promise<RunningStudyServer> {
  const dashboardSockets = new Set<WebSocket>();
  let runningPort = options.port;
  const manager = new StudySessionManager({
    dataRoot: options.dataRoot,
    counterbalancePlanPath: options.counterbalancePlanPath,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.startLeadMs === undefined
      ? {}
      : { startLeadMs: options.startLeadMs }),
    bindHost: options.host,
    initialPort: options.port,
    advertisedHost: options.advertisedHost ?? options.host,
    ...(options.approvedQuestBuildId === undefined
      ? {}
      : { approvedQuestBuildId: options.approvedQuestBuildId }),
    ...(options.pairingCodeTtlMs === undefined
      ? {}
      : { pairingCodeTtlMs: options.pairingCodeTtlMs }),
    drPreviewEnabled: options.drPreviewEnabled === true,
    onStateChanged: (state) => {
      const message = JSON.stringify({ type: "DASHBOARD_STATE", state });
      for (const socket of dashboardSockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    },
  });
  await manager.restoreActiveSession();

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get(
    "/api/state",
    route(async (_request, response) => {
      response.json(manager.getDashboardState());
    }),
  );
  app.post(
    "/api/session",
    route(async (request, response) => {
      response.status(201).json(await manager.createSession(request.body));
    }),
  );
  app.post(
    "/api/enrollment/code",
    route(async (request, response) => {
      const body = request.body as { deviceId: QuestDeviceId };
      response.json(await manager.issuePairingCode(body.deviceId));
    }),
  );
  app.post(
    "/api/enrollment/redeem",
    route(async (request, response) => {
      response.json(
        await manager.redeemPairingCode(request.body as EnrollmentRequest),
      );
    }),
  );
  app.post(
    "/api/preflight/begin",
    route(async (_request, response) => {
      response.json(await manager.beginPreflight());
    }),
  );
  app.post(
    "/api/preflight/item",
    route(async (request, response) => {
      const body = request.body as { key: PreflightKey; value: boolean };
      response.json(await manager.setPreflightItem(body.key, body.value));
    }),
  );
  app.post(
    "/api/preflight/confirm",
    route(async (_request, response) => {
      response.json(await manager.confirmPreflight());
    }),
  );
  app.post(
    "/api/calibration/start",
    route(async (_request, response) => {
      response.json(await manager.runCalibration());
    }),
  );
  app.post(
    "/api/calibration/simulate-pass",
    route(async (_request, response) => {
      response.json(await manager.simulateCalibrationPass());
    }),
  );
  app.post(
    "/api/calibration/override",
    route(async (request, response) => {
      response.json(
        await manager.overrideCalibration(request.body as GuardedActionInput),
      );
    }),
  );
  app.post(
    "/api/dr-preview",
    route(async (request, response) => {
      response.json(await manager.previewDiminishedReality(request.body));
    }),
  );
  app.post(
    "/api/trial/prepare",
    route(async (_request, response) => {
      response.json(await manager.prepareCurrentTrial());
    }),
  );
  app.post(
    "/api/trial/start",
    route(async (request, response) => {
      response.json(
        await manager.startTrial(request.body as GuardedActionInput),
      );
    }),
  );
  app.post(
    "/api/trial/submission",
    route(async (request, response) => {
      const body = request.body as { runtimeDecision: "CORRECT" | "INCORRECT" };
      response.json(await manager.recordSubmission(body.runtimeDecision));
    }),
  );
  app.post(
    "/api/trial/time-limit",
    route(async (request, response) => {
      response.json(
        await manager.endTrialAtTimeLimit(
          request.body as GuardedActionInput,
        ),
      );
    }),
  );
  app.post(
    "/api/trial/invalidate",
    route(async (request, response) => {
      response.json(
        await manager.invalidateActiveTrial(
          request.body as GuardedActionInput,
        ),
      );
    }),
  );
  app.post(
    "/api/trial/abort",
    route(async (request, response) => {
      const body = request.body as GuardedActionInput & {
        outcome: "PARTICIPANT_WITHDRAWAL" | "EXPERIMENTER_ABORTED";
      };
      response.json(await manager.abortActiveTrial(body.outcome, body));
    }),
  );
  app.post(
    "/api/post-trial/complete",
    route(async (_request, response) => {
      response.json(await manager.completePostTrial());
    }),
  );
  app.post(
    "/api/recovery/resolve",
    route(async (request, response) => {
      const body = request.body as GuardedActionInput & {
        outcome:
          | "TECHNICAL_INVALID"
          | "PARTICIPANT_WITHDRAWAL"
          | "EXPERIMENTER_ABORTED";
      };
      response.json(await manager.resolveRecovery(body.outcome, body));
    }),
  );
  app.post(
    "/api/recovery/confirm-continuation",
    route(async (request, response) => {
      const body = request.body as GuardedActionInput & {
        deviceId: QuestDeviceId;
      };
      response.json(
        await manager.confirmReconnectContinuation(body.deviceId, body),
      );
    }),
  );
  app.post(
    "/api/export/validate",
    route(async (_request, response) => {
      response.json(await manager.validateExports());
    }),
  );
  app.post(
    "/api/session/close",
    route(async (request, response) => {
      response.json(
        await manager.closeSession(request.body as GuardedActionInput),
      );
    }),
  );
  app.post(
    "/api/quest-logs/cleanup",
    route(async (request, response) => {
      response.json(
        await manager.cleanupQuestLocalLogs(
          request.body as GuardedActionInput,
        ),
      );
    }),
  );

  const httpServer = createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });
  let simulation: SimulationController | null = null;

  app.post(
    "/api/simulation/start",
    route(async (request, response) => {
      const state = manager.getDashboardState();
      if (state.session === null) {
        throw new Error("Create a session before starting simulators.");
      }
      simulation ??= new SimulationController(
        `ws://127.0.0.1:${runningPort}`,
      );
      const requested = (request.body as { deviceId?: QuestDeviceId }).deviceId;
      const targets =
        requested === undefined
          ? state.session.config.deviceAssignments
              .map(({ deviceId }) => deviceId)
              .filter(
                (deviceId) =>
                  !state.enrollments.find(
                    (enrollment) => enrollment.deviceId === deviceId,
                  )?.paired,
              )
          : [requested];
      if (targets.length === 0) {
        throw new Error("No unpaired Quest slot is available for simulation.");
      }
      for (const deviceId of targets) {
        const enrollment = await manager.enrollSimulation(deviceId);
        try {
          await simulation.startSlot(
            deviceId,
            enrollment.accessToken,
            state.session.config.approvedQuestBuildId,
          );
        } catch (error) {
          manager.releaseSimulationEnrollment(deviceId);
          throw error;
        }
      }
      response.json(manager.getDashboardState());
    }),
  );
  app.post(
    "/api/simulation/stop",
    route(async (request, response) => {
      const requested = (request.body as { deviceId?: QuestDeviceId }).deviceId;
      if (requested === undefined) {
        simulation?.stop();
        for (const enrollment of manager
          .getDashboardState()
          .enrollments.filter(({ simulation }) => simulation)) {
          manager.releaseSimulationEnrollment(enrollment.deviceId);
        }
      } else {
        simulation?.stopSlot(requested);
        manager.releaseSimulationEnrollment(requested);
      }
      response.json(manager.getDashboardState());
    }),
  );
  app.post(
    "/api/simulation/disconnect",
    route(async (request, response) => {
      const body = request.body as {
        deviceId: QuestDeviceId;
        durationMs: number;
      };
      if (simulation === null) {
        throw new Error("Simulators are not running.");
      }
      simulation.disconnect(body.deviceId, body.durationMs);
      response.json(manager.getDashboardState());
    }),
  );

  if (existsSync(options.dashboardDistPath)) {
    app.use(express.static(options.dashboardDistPath));
    app.get("/{*path}", (_request, response) => {
      response.sendFile(path.join(options.dashboardDistPath, "index.html"));
    });
  } else {
    app.get("/", (_request, response) => {
      response.json({
        service: "Collaborative DR Study Controller",
        dashboard:
          "Dashboard build not found. Run npm run dev or npm run build.",
      });
    });
  }

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const message =
        error instanceof Error ? error.message : "Unexpected server error.";
      response.status(400).json({ error: message });
    },
  );

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/ws", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/ws", "http://localhost");
    const clientType = url.searchParams.get("clientType");
    if (clientType === "dashboard") {
      dashboardSockets.add(socket);
      socket.send(
        JSON.stringify({
          type: "DASHBOARD_STATE",
          state: manager.getDashboardState(),
        }),
      );
      socket.on("close", () => dashboardSockets.delete(socket));
      return;
    }
    if (clientType === "quest") {
      const authorization = request.headers.authorization;
      const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? "");
      if (match?.[1] === undefined) {
        socket.close(1008, "Missing Quest bearer token.");
        return;
      }
      try {
        const identity = manager.authenticateQuestBearer(match[1]);
        void manager.registerQuestSocket(identity, socket).catch((error) => {
          socket.close(
            1008,
            error instanceof Error ? error.message : "Quest sync failed.",
          );
        });
      } catch (error) {
        socket.close(
          1008,
          error instanceof Error ? error.message : "Enrollment failed.",
        );
      }
      return;
    }
    socket.close(1008, "Unknown clientType.");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      const address = httpServer.address();
      if (typeof address === "object" && address !== null) {
        runningPort = address.port;
      }
      resolve();
    });
  });
  manager.setListeningPort(runningPort);

  return {
    host: options.host,
    port: runningPort,
    manager,
    close: async () => {
      simulation?.stop();
      manager.shutdown();
      for (const socket of dashboardSockets) {
        socket.close(1001, "Server shutting down.");
      }
      await closeWebSocketServer(websocketServer);
      await closeHttpServer(httpServer);
    },
  };
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
