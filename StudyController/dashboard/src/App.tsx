import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  PairingCodeView,
  QuestDeviceId,
} from "../../src/contracts";
import type {
  DashboardState,
  PreflightKey,
} from "../../src/runtimeTypes";
import { api } from "./api";

interface GuardedDialogState {
  title: string;
  endpoint: string;
  reasonRequired: boolean;
  body?: Record<string, unknown>;
  description?: string;
  confirmLabel?: string;
}

const manualPreflight: Array<{ key: PreflightKey; label: string }> = [
  { key: "recordingReady", label: "Simulated media system ready" },
  { key: "storageReady", label: "Capture storage ready" },
  {
    key: "physicalDistractorConfirmed",
    label: "TV / keyboard physical state confirmed",
  },
];

function formatStopwatch(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(
    2,
    "0",
  )}`;
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusPill({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return <span className={`status-pill ${ok ? "ok" : "waiting"}`}>{children}</span>;
}

export function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [dialog, setDialog] = useState<GuardedDialogState | null>(null);
  const [dialogReason, setDialogReason] = useState("");
  const [pairingCodes, setPairingCodes] = useState<
    Partial<Record<QuestDeviceId, PairingCodeView>>
  >({});

  const refresh = useCallback(async () => {
    try {
      setState(await api<DashboardState>("/api/state"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load state.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/ws?clientType=dashboard`,
    );
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as {
        type: string;
        state: DashboardState;
      };
      if (message.type === "DASHBOARD_STATE") {
        setState(message.state);
      }
    };
    return () => {
      window.clearInterval(interval);
      socket.close();
    };
  }, [refresh]);

  const perform = useCallback(
    async (endpoint: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api<DashboardState>(endpoint, body);
        setState(result);
        setSubmissionOpen(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const generatePairingCode = useCallback(async (deviceId: QuestDeviceId) => {
    setBusy(true);
    setError(null);
    try {
      const pairingCode = await api<PairingCodeView>("/api/enrollment/code", {
        deviceId,
      });
      setPairingCodes((current) => ({
        ...current,
        [deviceId]: pairingCode,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to issue pairing code.");
    } finally {
      setBusy(false);
    }
  }, []);

  const actions = useMemo(
    () => new Set(state?.availableActions ?? []),
    [state?.availableActions],
  );

  if (state === null) {
    return <main className="loading">Loading study controller…</main>;
  }

  const session = state.session;
  const trial = state.currentTrial;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Experimenter console</p>
          <h1>Collaborative DR Study Controller</h1>
        </div>
        <div className="topbar-status">
          <span className="state-badge">{state.laptopState}</span>
          <div
            className={`timer ${state.timer.running ? "running" : ""} ${
              state.timer.limitReached ? "limit-reached" : ""
            }`}
          >
            <span>
              {state.timer.limitReached
                ? "Time limit reached"
                : "Trial stopwatch"}
            </span>
            <strong>{formatStopwatch(state.timer.elapsedMs)}</strong>
          </div>
        </div>
      </header>

      {error !== null && (
        <div className="alert error" role="alert">
          <strong>Action blocked</strong>
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <ServerConnectionCard connection={state.serverConnection} />

      {session === null ? (
        <SessionSetup busy={busy} onCreate={perform} />
      ) : (
        <>
          <section className="overview-grid">
            <article className="panel session-summary">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Active session</p>
                  <h2>{session.config.pairId}</h2>
                </div>
                <span className="mono">v{state.stateVersion}</span>
              </div>
              <dl className="metadata">
                <div>
                  <dt>Allocation</dt>
                  <dd>{session.allocationId}</dd>
                </div>
                <div>
                  <dt>Schedule</dt>
                  <dd>{session.scheduleId}</dd>
                </div>
                <div>
                  <dt>Current trial</dt>
                  <dd>
                    {trial === null
                      ? "None"
                      : `${trial.definition.trialId} · ${trial.definition.kind}`}
                  </dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{state.completedTrialIds.length}</dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Quest clients</p>
                  <h2>Device status</h2>
                  <p className="panel-note">
                    Enrol a physical Quest or start a simulator in each temporary slot.
                  </p>
                </div>
              </div>
              <div className="device-list">
                {state.devices.map((device) => {
                  const enrollment = state.enrollments.find(
                    ({ deviceId }) => deviceId === device.deviceId,
                  );
                  return (
                    <QuestSlotCard
                      busy={busy}
                      device={device}
                      enrollment={enrollment}
                      key={device.deviceId}
                      pairingCode={pairingCodes[device.deviceId]}
                      onGeneratePairingCode={() =>
                        void generatePairingCode(device.deviceId)
                      }
                      onStartSimulator={() =>
                        void perform("/api/simulation/start", {
                          deviceId: device.deviceId,
                        })
                      }
                      onStopSimulator={() =>
                        void perform("/api/simulation/stop", {
                          deviceId: device.deviceId,
                        })
                      }
                      onFaultSimulator={() =>
                        void perform("/api/simulation/disconnect", {
                          deviceId: device.deviceId,
                          durationMs: 4_000,
                        })
                      }
                    />
                  );
                })}
              </div>
            </article>
          </section>

          {actions.has("BEGIN_PREFLIGHT") && (
            <section className="panel action-panel">
              <div>
                <p className="eyebrow">Next gate</p>
                <h2>Begin trial preflight</h2>
                <p>Resets the physical and media checks for the next scheduled trial.</p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void perform("/api/preflight/begin")}
              >
                Begin preflight
              </button>
            </section>
          )}

          {state.laptopState === "PREFLIGHT" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Guarded gate</p>
                  <h2>Preflight</h2>
                </div>
                <span>
                  {Object.values(state.preflight).filter(Boolean).length}/5 ready
                </span>
              </div>
              <div className="check-grid">
                <ReadOnlyCheck
                  checked={state.preflight.directorQuestConnected}
                  label="Director Quest connected"
                />
                <ReadOnlyCheck
                  checked={state.preflight.builderQuestConnected}
                  label="Builder Quest connected"
                />
                {manualPreflight.map(({ key, label }) => (
                  <label className="check-item" key={key}>
                    <input
                      type="checkbox"
                      checked={state.preflight[key]}
                      disabled={busy}
                      onChange={(event) =>
                        void perform("/api/preflight/item", {
                          key,
                          value: event.target.checked,
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !Object.values(state.preflight).every(Boolean)}
                  onClick={() => void perform("/api/preflight/confirm")}
                >
                  Confirm preflight
                </button>
              </div>
            </section>
          )}

          {state.laptopState === "CALIBRATION" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Phase 5 guarded gate</p>
                  <h2>Six-tag room calibration</h2>
                  <p className="panel-note">
                    Both Quest slots sample IDs 1–6 for six seconds. Slowly sweep from
                    the keyboard to the TV if all tags are not visible at once. The
                    locked detector-corner side is 0.0567 m. Only derived reports are
                    returned; raw passthrough frames are discarded on-headset.
                  </p>
                </div>
                <StatusPill
                  ok={state.calibrationComparison.status === "PASS"}
                >
                  {state.calibrationComparison.status}
                </StatusPill>
              </div>
              <div className="device-list">
                {state.devices.map((device) => {
                  const received = state.calibrationReports.find(
                    ({ deviceId }) => deviceId === device.deviceId,
                  );
                  return (
                    <article className="device-card" key={`cal-${device.deviceId}`}>
                      <div className="panel-heading">
                        <strong>{device.deviceId}</strong>
                        <StatusPill ok={device.calibrationStatus === "PASS"}>
                          {device.calibrationStatus}
                        </StatusPill>
                      </div>
                      {received === undefined ? (
                        <p className="muted">No Phase 5 report received.</p>
                      ) : (
                        <dl className="metadata">
                          <div>
                            <dt>Tags observed</dt>
                            <dd>{received.report.observedTagIds.join(", ") || "None"}</dd>
                          </div>
                          <div>
                            <dt>Accepted / rejected</dt>
                            <dd>
                              {received.report.acceptedObservationCount} / {received.report.rejectedObservationCount}
                            </dd>
                          </div>
                          <div>
                            <dt>Keyboard spacing</dt>
                            <dd>
                              {received.report.keyboardSpacingMeters === null
                                ? "—"
                                : `${received.report.keyboardSpacingMeters.toFixed(3)} m (${received.report.keyboardSpacingResidualMeters?.toFixed(4) ?? "—"} m residual)`}
                            </dd>
                          </div>
                          <div>
                            <dt>TV planarity RMS</dt>
                            <dd>
                              {received.report.tvPlanarityRmsMeters === null
                                ? "3-tag redundancy"
                                : `${received.report.tvPlanarityRmsMeters.toFixed(4)} m`}
                            </dd>
                          </div>
                          <div>
                            <dt>Threshold profile</dt>
                            <dd className="mono">{received.report.thresholdProfile}</dd>
                          </div>
                        </dl>
                      )}
                      {received !== undefined && (
                        <details>
                          <summary>Per-tag stability</summary>
                          <dl className="metadata">
                            {received.report.tagSamples.map((sample) => (
                              <div key={`tag-${sample.tagId}`}>
                                <dt>Tag {sample.tagId}</dt>
                                <dd>
                                  {sample.acceptedCount} accepted / {sample.rejectedCount} rejected · {sample.positionRmsMeters.toFixed(4)} m · {sample.rotationRmsDegrees.toFixed(2)}°
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                      {received?.report.failureReasons.map((reason) => (
                        <p className="issue" key={reason}>{reason}</p>
                      ))}
                      {received?.report.warnings.map((warning) => (
                        <p className="muted mono" key={warning}>{warning}</p>
                      ))}
                    </article>
                  );
                })}
              </div>
              {state.calibrationComparison.reason !== null && (
                <p className="panel-note">{state.calibrationComparison.reason}</p>
              )}
              {state.calibrationComparison.tvPositionDifferenceMeters !== null && (
                <p className="mono">
                  Cross-Quest TV transform difference: {state.calibrationComparison.tvPositionDifferenceMeters.toFixed(4)} m / {state.calibrationComparison.tvRotationDifferenceDegrees?.toFixed(2)}°
                </p>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !state.devices.every(({ connected }) => connected)}
                  onClick={() => void perform("/api/calibration/start")}
                >
                  Start six-second calibration
                </button>
                {state.devices.every(({ simulation }) => simulation) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void perform("/api/calibration/simulate-pass")}
                  >
                    Simulation-only PASS
                  </button>
                )}
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDialog({
                      title: "Override calibration",
                      endpoint: "/api/calibration/override",
                      reasonRequired: true,
                    })
                  }
                >
                  Override with reason
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !state.devices.every(
                      ({ connected, calibrationStatus }) =>
                        connected &&
                        (calibrationStatus === "PASS" ||
                          calibrationStatus === "OVERRIDDEN"),
                    )
                  }
                  onClick={() => void perform("/api/trial/prepare")}
                >
                  Prepare trial
                </button>
              </div>
            </section>
          )}

          {state.drPreview.enabled && state.laptopState === "CALIBRATION" && (
            <DrPreviewPanel
              busy={busy}
              enabled={actions.has("DR_PREVIEW")}
              preview={state.drPreview}
              onCommand={perform}
            />
          )}

          {state.liveReconnects.length > 0 && (
            <section className="panel live-reconnect-panel" role="status">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Active-trial interlock</p>
                  <h2>Quest reconnect recovery</h2>
                  <p className="panel-note">
                    The authoritative stopwatch continues, but trial actions remain
                    blocked until the validated Quest snapshot is explicitly confirmed.
                  </p>
                </div>
              </div>
              <div className="reconnect-list">
                {state.liveReconnects.map((reconnect) => (
                  <div className="reconnect-row" key={reconnect.deviceId}>
                    <div>
                      <strong>{reconnect.deviceId}</strong>
                      <span>
                        {reconnect.phase === "DISCONNECTED"
                          ? "Disconnected — preserving the last valid DR state"
                          : reconnect.phase === "AWAITING_SNAPSHOT"
                            ? "Reconnected — validating the authoritative snapshot"
                            : "Snapshot validated — experimenter confirmation required"}
                      </span>
                      {reconnect.disconnectDurationMs !== null && (
                        <span className="mono">
                          Disconnected for {reconnect.disconnectDurationMs} ms
                        </span>
                      )}
                    </div>
                    {reconnect.phase ===
                      "AWAITING_EXPERIMENTER_CONFIRMATION" && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !actions.has("CONFIRM_RECONNECT_CONTINUATION")
                        }
                        onClick={() =>
                          setDialog({
                            title: `Continue trial with ${reconnect.deviceId}`,
                            endpoint: "/api/recovery/confirm-continuation",
                            reasonRequired: false,
                            body: { deviceId: reconnect.deviceId },
                            description:
                              "The Quest applied and validated the current server snapshot. Confirm that this headset may continue the active trial.",
                            confirmLabel: "Confirm continuation",
                          })
                        }
                      >
                        Confirm continuation
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {state.laptopState === "TRIAL_PREPARED" && trial !== null && (
            <TrialCard state={state}>
              <button
                className="primary danger-outline"
                disabled={busy}
                onClick={() =>
                  setDialog({
                    title: `Start ${trial.definition.trialId}`,
                    endpoint: "/api/trial/start",
                    reasonRequired: false,
                  })
                }
              >
                Confirm and start trial
              </button>
            </TrialCard>
          )}

          {state.laptopState === "TRIAL_ACTIVE" && trial !== null && (
            <TrialCard state={state}>
              {state.timer.limitReached && (
                <div className="time-limit-notice" role="alert">
                  <strong>Time limit reached</strong>
                  <span>
                    Submissions remain recordable, but they are marked late and
                    cannot produce an on-time completion.
                  </span>
                  <button
                    className="primary time-limit-button"
                    disabled={busy || !actions.has("END_TIME_LIMIT")}
                    onClick={() =>
                      setDialog({
                        title: "End trial — time limit reached",
                        endpoint: "/api/trial/time-limit",
                        reasonRequired: false,
                      })
                    }
                  >
                    End trial — time limit reached
                  </button>
                </div>
              )}
              {!submissionOpen ? (
                <button
                  className="primary submit-button"
                  disabled={busy || !actions.has("RECORD_SUBMISSION")}
                  onClick={() => setSubmissionOpen(true)}
                >
                  {state.timer.limitReached
                    ? "Record late submission"
                    : "Record submission"}
                </button>
              ) : (
                <div className="submission-decision">
                  <strong>
                    {state.timer.limitReached
                      ? "Late construction decision"
                      : "Construction decision"}
                  </strong>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform("/api/trial/submission", {
                        runtimeDecision: "INCORRECT",
                      })
                    }
                  >
                    Incorrect — say “Continue”
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      setDialog({
                        title: state.timer.limitReached
                          ? "Confirm late correct submission and end as TIMEOUT"
                          : "Confirm correct submission and end trial",
                        endpoint: "/api/trial/submission",
                        reasonRequired: false,
                        body: { runtimeDecision: "CORRECT" },
                      })
                    }
                  >
                    {state.timer.limitReached
                      ? "Correct — end as timeout"
                      : "Correct — end trial"}
                  </button>
                  <button className="ghost" onClick={() => setSubmissionOpen(false)}>
                    Cancel
                  </button>
                </div>
              )}
              <button
                className="ghost danger-text"
                disabled={busy}
                onClick={() =>
                  setDialog({
                    title: "Invalidate active trial",
                    endpoint: "/api/trial/invalidate",
                    reasonRequired: true,
                  })
                }
              >
                Technical invalidation
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  setDialog({
                    title: "Record participant withdrawal",
                    endpoint: "/api/trial/abort",
                    reasonRequired: true,
                    body: { outcome: "PARTICIPANT_WITHDRAWAL" },
                  })
                }
              >
                Participant withdrawal
              </button>
            </TrialCard>
          )}

          {state.laptopState === "POST_TRIAL" && (
            <section className="panel action-panel">
              <div>
                <p className="eyebrow">Trial recorded</p>
                <h2>{trial?.outcome ?? "Outcome saved"}</h2>
                <p>Complete the required post-trial checks before advancing.</p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void perform("/api/post-trial/complete")}
              >
                Complete post-trial
              </button>
            </section>
          )}

          {state.laptopState === "RECOVERY_REQUIRED" && (
            <section className="panel recovery-panel">
              <p className="eyebrow">Stopwatch intentionally stopped</p>
              <h2>Recovery decision required</h2>
              <p>{state.recovery.reason}</p>
              <div className="button-row">
                {[
                  ["TECHNICAL_INVALID", "Technical invalid — schedule reserve"],
                  ["PARTICIPANT_WITHDRAWAL", "Participant withdrawal"],
                  ["EXPERIMENTER_ABORTED", "Experimenter abort"],
                ].map(([outcome, label]) => (
                  <button
                    className={outcome === "TECHNICAL_INVALID" ? "primary" : "ghost"}
                    key={outcome}
                    onClick={() =>
                      setDialog({
                        title: label,
                        endpoint: "/api/recovery/resolve",
                        reasonRequired: true,
                        body: { outcome },
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="lower-grid">
            <article className="panel">
              <p className="eyebrow">Fault visibility</p>
              <h2>Active faults</h2>
              {state.faults.length === 0 ? (
                <p className="muted">No active faults.</p>
              ) : (
                <ul className="fault-list">
                  {state.faults.map((fault) => (
                    <li key={fault.faultId}>
                      <strong>{fault.source}</strong>
                      <span>{fault.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Data integrity</p>
                  <h2>Export validation</h2>
                </div>
                {state.exportValidation !== null && (
                  <StatusPill ok={state.exportValidation.valid}>
                    {state.exportValidation.valid ? "Valid" : "Blocked"}
                  </StatusPill>
                )}
              </div>
              {state.exportValidation === null ? (
                <p className="muted">No export validation run yet.</p>
              ) : (
                <>
                  <p>
                    {state.exportValidation.counts.completed}/
                    {state.exportValidation.counts.scheduled} trial outcomes recorded.
                  </p>
                  {state.exportValidation.issues.map((issue) => (
                    <p className="issue" key={issue}>
                      {issue}
                    </p>
                  ))}
                </>
              )}
              <QuestLogStatus
                devices={state.devices}
                localLogs={state.localLogs}
              />
              {actions.has("VALIDATE_EXPORT") && (
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void perform("/api/export/validate")}
                  >
                    Validate export
                  </button>
                  {state.laptopState === "SESSION_COMPLETE" &&
                    actions.has("CLEANUP_QUEST_LOCAL_LOGS") && (
                      <button
                        className="ghost danger-text"
                        disabled={busy}
                        onClick={() =>
                          setDialog({
                            title: "Clean up Quest backup logs",
                            endpoint: "/api/quest-logs/cleanup",
                            reasonRequired: false,
                            description:
                              "The laptop export is valid. This separate action permanently deletes the retained local backup log from each reachable Quest.",
                            confirmLabel: "Clean up Quest logs",
                          })
                        }
                      >
                        Clean up Quest backup logs
                      </button>
                    )}
                  <button
                    className="primary"
                    disabled={busy || state.exportValidation?.valid !== true}
                    onClick={() =>
                      setDialog({
                        title: "Close completed session",
                        endpoint: "/api/session/close",
                        reasonRequired: true,
                      })
                    }
                  >
                    Close session
                  </button>
                </div>
              )}
            </article>
          </section>
        </>
      )}

      {dialog !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true">
            <p className="eyebrow">Guarded action</p>
            <h2>{dialog.title}</h2>
            {dialog.description !== undefined && <p>{dialog.description}</p>}
            {dialog.reasonRequired && (
              <label>
                Reason
                <textarea
                  autoFocus
                  value={dialogReason}
                  onChange={(event) => setDialogReason(event.target.value)}
                  placeholder="Record the factual reason for this action."
                />
              </label>
            )}
            <div className="button-row">
              <button
                className="ghost"
                onClick={() => {
                  setDialog(null);
                  setDialogReason("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  busy || (dialog.reasonRequired && dialogReason.trim().length === 0)
                }
                onClick={() => {
                  const current = dialog;
                  setDialog(null);
                  void perform(current.endpoint, {
                    ...(current.body ?? {}),
                    confirmed: true,
                    ...(current.reasonRequired
                      ? { reason: dialogReason.trim() }
                      : {}),
                  });
                  setDialogReason("");
                }}
              >
                {dialog.confirmLabel ?? "Confirm action"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ServerConnectionCard({
  connection,
}: {
  connection: DashboardState["serverConnection"];
}) {
  return (
    <section className="panel connection-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Researcher networking</p>
          <h2>Quest connection details</h2>
        </div>
        <StatusPill ok={connection.port > 0}>
          {connection.port > 0 ? `Listening on ${connection.port}` : "Starting"}
        </StatusPill>
      </div>
      <dl className="metadata connection-metadata">
        <div>
          <dt>Dashboard / HTTP</dt>
          <dd className="mono network-value">{connection.advertisedHttpUrl}</dd>
        </div>
        <div>
          <dt>Quest WebSocket</dt>
          <dd className="mono network-value">
            {connection.advertisedWebSocketUrl}
          </dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd className="mono">{connection.protocolVersion}</dd>
        </div>
        <div>
          <dt>Approved Quest build</dt>
          <dd className="mono network-value">
            {connection.approvedQuestBuildId}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function QuestSlotCard({
  busy,
  device,
  enrollment,
  pairingCode,
  onGeneratePairingCode,
  onStartSimulator,
  onStopSimulator,
  onFaultSimulator,
}: {
  busy: boolean;
  device: DashboardState["devices"][number];
  enrollment: DashboardState["enrollments"][number] | undefined;
  pairingCode: PairingCodeView | undefined;
  onGeneratePairingCode: () => void;
  onStartSimulator: () => void;
  onStopSimulator: () => void;
  onFaultSimulator: () => void;
}) {
  const paired = enrollment?.paired === true;
  const simulated = enrollment?.simulation === true;
  const codeExpired =
    pairingCode !== undefined &&
    Date.parse(pairingCode.expiresAtUtc) <= Date.now();

  return (
    <div className="device-row">
      <div className="device-summary">
        <strong>{device.role ?? "Unassigned slot"}</strong>
        <span>
          {device.deviceId} · {device.participantId ?? "Awaiting participant"}
        </span>
        <div className="device-runtime-details">
          <span>
            {paired
              ? simulated
                ? "Simulator enrolled"
                : "Physical Quest enrolled"
              : "Vacant session slot"}
          </span>
          {paired && (
            <span className="mono">
              {enrollment?.protocolVersion ?? "Protocol pending"} ·{" "}
              {enrollment?.appBuildId ?? "Build pending"}
            </span>
          )}
        </div>
        {pairingCode !== undefined && (
          <div className="pairing-card" aria-live="polite">
            <div>
              <span>One-time pairing code</span>
              <output className="pairing-code">{pairingCode.code}</output>
            </div>
            <div className="pairing-expiry">
              <StatusPill ok={!codeExpired && !paired}>
                {paired ? "Used" : codeExpired ? "Expired" : "Valid"}
              </StatusPill>
              <span>Expires {formatLocalTimestamp(pairingCode.expiresAtUtc)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="device-controls">
        <div className="device-metrics">
          <StatusPill ok={paired}>{paired ? "Paired" : "Unpaired"}</StatusPill>
          <StatusPill ok={device.connected}>
            {device.connected ? "Connected" : "Offline"}
          </StatusPill>
          <StatusPill
            ok={
              device.calibrationStatus === "PASS" ||
              device.calibrationStatus === "OVERRIDDEN"
            }
          >
            {device.calibrationStatus}
          </StatusPill>
        </div>
        <div className="slot-actions">
          <button
            className="secondary"
            disabled={busy || paired}
            onClick={onGeneratePairingCode}
          >
            {pairingCode === undefined
              ? "Generate pairing code"
              : "Generate new code"}
          </button>
          {!simulated ? (
            <button
              className="ghost"
              disabled={busy || paired}
              onClick={onStartSimulator}
            >
              Start simulator
            </button>
          ) : (
            <>
              <button className="ghost" disabled={busy} onClick={onStopSimulator}>
                Stop simulator
              </button>
              <button
                className="ghost"
                disabled={busy || !device.connected}
                onClick={onFaultSimulator}
              >
                Simulate fault
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DrPreviewPanel({
  busy,
  enabled,
  preview,
  onCommand,
}: {
  busy: boolean;
  enabled: boolean;
  preview: DashboardState["drPreview"];
  onCommand: (
    endpoint: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [target, setTarget] = useState<"TV" | "KEYBOARD">("TV");
  const [debugBounds, setDebugBounds] = useState(false);
  const command = (
    action: "PREPARE" | "SHOW" | "HIDE" | "REVEAL" | "REPORT",
  ) => onCommand("/api/dr-preview", { action, target });

  return (
    <section className="panel dr-preview-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 6 researcher tool</p>
          <h2>DR placement preview</h2>
          <p className="panel-note">
            Development-only controls for the white TV and keyboard masks. The
            server disables this panel unless DR_PREVIEW_ENABLED=true, and all
            controls are locked out once a trial is prepared.
          </p>
        </div>
        <span className="mono">{preview.profileVersion}</span>
      </div>
      <div className="dr-preview-controls">
        <label>
          Target
          <select
            disabled={busy || !enabled}
            value={target}
            onChange={(event) =>
              setTarget(event.target.value as "TV" | "KEYBOARD")
            }
          >
            <option value="TV">TV</option>
            <option value="KEYBOARD">Keyboard</option>
          </select>
        </label>
        <label className="check-item">
          <input
            type="checkbox"
            checked={debugBounds}
            disabled={busy || !enabled}
            onChange={(event) => {
              const value = event.target.checked;
              setDebugBounds(value);
              void onCommand("/api/dr-preview", {
                action: "SET_DEBUG_BOUNDS",
                target,
                debugBounds: value,
              });
            }}
          />
          <span>Researcher debug bounds</span>
        </label>
      </div>
      <div className="button-row">
        <button
          className="secondary"
          disabled={busy || !enabled}
          onClick={() => void command("PREPARE")}
        >
          Prepare
        </button>
        <button
          className="primary"
          disabled={busy || !enabled}
          onClick={() => void command("SHOW")}
        >
          Show mask
        </button>
        <button
          className="ghost"
          disabled={busy || !enabled}
          onClick={() => void command("REVEAL")}
        >
          Reveal object
        </button>
        <button
          className="ghost"
          disabled={busy || !enabled}
          onClick={() => void command("HIDE")}
        >
          Hide and clear
        </button>
        <button
          className="ghost"
          disabled={busy || !enabled}
          onClick={() => void command("REPORT")}
        >
          Report state / FPS
        </button>
      </div>
      <div className="device-list dr-state-list">
        {preview.reports.length === 0 ? (
          <p className="muted">No Phase 6 state report received yet.</p>
        ) : (
          preview.reports.map(({ deviceId, report }) => (
            <article className="device-card" key={`dr-${deviceId}`}>
              <div className="panel-heading">
                <strong>{deviceId}</strong>
                <StatusPill ok={report.drStateMatches}>
                  {report.actualState}
                </StatusPill>
              </div>
              <dl className="metadata">
                <div>
                  <dt>Target / action</dt>
                  <dd>{report.target ?? "None"} · {report.requestedAction}</dd>
                </div>
                <div>
                  <dt>Mask / debug</dt>
                  <dd>
                    {report.maskVisible ? "Visible" : "Hidden"} / {report.debugBoundsVisible ? "Bounds on" : "Bounds off"}
                  </dd>
                </div>
                <div>
                  <dt>Measured FPS</dt>
                  <dd>
                    {report.measuredFps === null
                      ? "Collecting"
                      : `${report.measuredFps.toFixed(1)} / ${report.performanceTargetFps}`}
                  </dd>
                </div>
                <div>
                  <dt>Performance gate</dt>
                  <dd>
                    {!report.performanceGateEvaluated
                      ? "Not yet evaluated"
                      : report.performanceGatePass
                        ? "PASS"
                        : "CHECK"}
                  </dd>
                </div>
              </dl>
              {report.reason !== null && <p className="issue">{report.reason}</p>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function QuestLogStatus({
  devices,
  localLogs,
}: {
  devices: DashboardState["devices"];
  localLogs: DashboardState["localLogs"];
}) {
  return (
    <div className="quest-log-section">
      <h3>Quest backup logs</h3>
      <div className="quest-log-list">
        {devices.map((device) => {
          const localLog = localLogs.find(
            ({ deviceId }) => deviceId === device.deviceId,
          );
          return (
            <div className="quest-log-row" key={device.deviceId}>
              <div>
                <strong>{device.deviceId}</strong>
                <span>
                  {localLog === undefined
                    ? "Status not yet reported"
                    : localLog.retained
                      ? `${localLog.recordCount} local records retained`
                      : `Cleaned · reported ${formatLocalTimestamp(
                          localLog.reportedAtUtc,
                        )}`}
                </span>
              </div>
              <StatusPill ok={localLog !== undefined}>
                {localLog === undefined
                  ? "Not reported"
                  : localLog.retained
                    ? "Retained"
                    : "Cleaned"}
              </StatusPill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionSetup({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (
    endpoint: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [pairId, setPairId] = useState("PAIR-001");
  const [participantAId, setParticipantAId] = useState("P001-A");
  const [participantBId, setParticipantBId] = useState("P001-B");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onCreate("/api/session", {
      pairId,
      participantAId,
      participantBId,
    });
  };

  return (
    <section className="panel setup-panel">
      <div>
        <p className="eyebrow">No active session</p>
        <h2>Create a pseudonymous study session</h2>
        <p>
          The server loads the validated allocation for the pair ID and writes a
          locked session-specific schedule.
        </p>
      </div>
      <form onSubmit={submit}>
        <label>
          Pair ID
          <input
            pattern="PAIR-[0-9]{3,}"
            required
            value={pairId}
            onChange={(event) => setPairId(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Participant slot A
          <input
            pattern="P[0-9]{3,}-A"
            required
            value={participantAId}
            onChange={(event) =>
              setParticipantAId(event.target.value.toUpperCase())
            }
          />
        </label>
        <label>
          Participant slot B
          <input
            pattern="P[0-9]{3,}-B"
            required
            value={participantBId}
            onChange={(event) =>
              setParticipantBId(event.target.value.toUpperCase())
            }
          />
        </label>
        <button className="primary" disabled={busy} type="submit">
          Create session
        </button>
      </form>
    </section>
  );
}

function ReadOnlyCheck({
  checked,
  label,
}: {
  checked: boolean;
  label: string;
}) {
  return (
    <div className={`check-item readonly ${checked ? "checked" : ""}`}>
      <span className="check-icon">{checked ? "✓" : "—"}</span>
      <span>{label}</span>
    </div>
  );
}

function TrialCard({
  state,
  children,
}: {
  state: DashboardState;
  children: React.ReactNode;
}) {
  const trial = state.currentTrial!;
  return (
    <section className="panel trial-panel">
      <div>
        <p className="eyebrow">
          {trial.definition.kind} · Trial {state.currentTrialIndex + 1}
        </p>
        <h2>{trial.definition.trialId}</h2>
        <div className="trial-facts">
          <span>{trial.definition.condition}</span>
          <span>{trial.definition.distractorType}</span>
          <span>{trial.definition.puzzleId}</span>
          <span>{trial.submissionCount} submissions</span>
        </div>
      </div>
      <div className="trial-actions">{children}</div>
    </section>
  );
}
