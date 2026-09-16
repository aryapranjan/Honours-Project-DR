using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using CollaborativeDR.Calibration;
using CollaborativeDR.DiminishedReality;
using CollaborativeDR.Protocol;
using CollaborativeDR.StudyCore;
using NativeWebSocket;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace CollaborativeDR.Networking
{
    [DisallowMultipleComponent]
    public sealed class StudyNetworkClient : MonoBehaviour
    {
        private const string SavedServerAddressKey = "CollaborativeDR.ServerAddress";
        private const int EnrollmentTimeoutSeconds = 10;
        private static StudyNetworkClient instance;

        private readonly LocalStudyState localState = new LocalStudyState();
        private readonly StudyClientStatus status = new StudyClientStatus();
        private readonly Dictionary<int, double> heartbeatSentAt =
            new Dictionary<int, double>();
        private CommandValidator commandValidator;
        private AprilTagCalibrationManager calibrationManager;
        private DiminishedRealityManager diminishedRealityManager;
        private IVisualSafetyController safetyController;
        private IQuestEventLog eventLog;
        private WebSocket socket;
        private EnrollmentResponse enrollment;
        private string accessToken = string.Empty;
        private string clientInstanceId = string.Empty;
        private Coroutine enrollmentRoutine;
        private Coroutine reconnectRoutine;
        private double nextHeartbeatAt;
        private double lastServerMessageAt = -1d;
        private double disconnectedAt = -1d;
        private int heartbeatSequence;
        private int reconnectAttempt;
        private bool localCriticalFaultRaised;
        private bool livenessReconnectRequested;
        private bool applicationQuitting;
        private JObject pendingSnapshotDrState;

        public event Action<StudyClientStatus> StatusChanged;

        public StudyClientStatus CurrentStatus => status.Copy();

        private void Awake()
        {
            if (instance != null && instance != this)
            {
                Destroy(gameObject);
                return;
            }

            instance = this;
            DontDestroyOnLoad(gameObject);
            Application.runInBackground = true;
            commandValidator = new CommandValidator(localState);
            calibrationManager = GetComponent<AprilTagCalibrationManager>();
            diminishedRealityManager = GetComponent<DiminishedRealityManager>();
            safetyController = GetComponents<MonoBehaviour>()
                .OfType<IVisualSafetyController>()
                .FirstOrDefault();
            eventLog = GetComponents<MonoBehaviour>()
                .OfType<IQuestEventLog>()
                .FirstOrDefault();
            clientInstanceId = LoadOrCreateClientInstanceId();
            status.ServerAddress = PlayerPrefs.GetString(
                SavedServerAddressKey,
                string.Empty);
            status.HeadsetModel = SystemInfo.deviceModel;
            status.ProtocolVersion = StudyProtocol.ProtocolVersion;
            status.AppBuildId = StudyProtocol.AppBuildId;
            SetPhase(
                StudyClientPhase.Setup,
                "Enter the laptop IPv4 address and one-time pairing code.");
        }

        private void Update()
        {
            double now = Time.realtimeSinceStartupAsDouble;
            if (socket != null && socket.State == WebSocketState.Open)
            {
                if (now >= nextHeartbeatAt)
                {
                    nextHeartbeatAt = now + StudyProtocol.HeartbeatIntervalSeconds;
                    _ = SendHeartbeatAsync();
                }

                if (lastServerMessageAt >= 0d &&
                    now - lastServerMessageAt > StudyProtocol.CriticalDisconnectSeconds)
                {
                    EnterLocalFailSafe("server_heartbeat_timeout");
                    if (!livenessReconnectRequested)
                    {
                        livenessReconnectRequested = true;
                        _ = RestartSocketAfterLivenessTimeoutAsync();
                    }
                }
            }
            else if (disconnectedAt >= 0d)
            {
                double disconnectedMilliseconds = (now - disconnectedAt) * 1000d;
                if (ReconnectPolicy.Evaluate(disconnectedMilliseconds) ==
                    DisconnectAction.EnterFailSafe)
                {
                    EnterLocalFailSafe("connection_lost_over_three_seconds");
                }
                else
                {
                    safetyController?.PreserveLastValidState();
                }
            }
        }

        public void BeginEnrollment(string serverAddress, string pairingCode)
        {
            if (!TryNormalizeServerAddress(
                    serverAddress,
                    out string normalizedAddress,
                    out string error))
            {
                SetPhase(StudyClientPhase.Setup, error);
                return;
            }

            string trimmedCode = pairingCode?.Trim() ?? string.Empty;
            if (trimmedCode.Length != 6 || trimmedCode.Any(character => !char.IsDigit(character)))
            {
                SetPhase(StudyClientPhase.Setup, "The pairing code must contain six digits.");
                return;
            }

            if (enrollmentRoutine != null)
            {
                StopCoroutine(enrollmentRoutine);
            }

            status.ServerAddress = normalizedAddress;
            PlayerPrefs.SetString(SavedServerAddressKey, normalizedAddress);
            PlayerPrefs.Save();
            enrollmentRoutine = StartCoroutine(
                EnrollRoutine(normalizedAddress, trimmedCode));
        }

        public void ResetEnrollment()
        {
            StopConnectionLoops();
            _ = CloseSocketAsync();
            accessToken = string.Empty;
            enrollment = null;
            localState.ResetEnrollment();
            heartbeatSentAt.Clear();
            localCriticalFaultRaised = false;
            livenessReconnectRequested = false;
            disconnectedAt = -1d;
            safetyController?.ExitFailSafeAfterAuthoritativeContinuation();
            status.IsPaired = false;
            status.DeviceId = string.Empty;
            status.ParticipantId = string.Empty;
            status.Role = string.Empty;
            status.SessionId = string.Empty;
            status.LastAppliedStateVersion = 0;
            SetPhase(StudyClientPhase.Setup, "Enrollment reset. Enter a new pairing code.");
        }

        private IEnumerator EnrollRoutine(string serverAddress, string pairingCode)
        {
            SetPhase(StudyClientPhase.Enrolling, "Pairing with the study server…");
            EnrollmentRequest body = new EnrollmentRequest
            {
                PairingCode = pairingCode,
                ClientInstanceId = clientInstanceId,
                ProtocolVersion = StudyProtocol.ProtocolVersion,
                AppBuildId = StudyProtocol.AppBuildId
            };
            byte[] requestBody = Encoding.UTF8.GetBytes(ProtocolJson.Serialize(body));
            string endpoint = $"{serverAddress}/api/enrollment/redeem";
            using (UnityWebRequest request = new UnityWebRequest(endpoint, "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(requestBody);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.timeout = EnrollmentTimeoutSeconds;
                yield return request.SendWebRequest();

                enrollmentRoutine = null;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    string detail = string.IsNullOrWhiteSpace(request.downloadHandler.text)
                        ? request.error
                        : request.downloadHandler.text;
                    SetPhase(StudyClientPhase.Setup, $"Pairing failed: {detail}");
                    yield break;
                }

                EnrollmentResponse response;
                try
                {
                    response = ProtocolJson.Deserialize<EnrollmentResponse>(
                        request.downloadHandler.text);
                }
                catch (Exception exception)
                {
                    SetPhase(StudyClientPhase.Setup, $"Invalid pairing response: {exception.Message}");
                    yield break;
                }

                if (!ValidateEnrollmentResponse(response, out string validationError))
                {
                    SetPhase(StudyClientPhase.Setup, validationError);
                    yield break;
                }

                enrollment = response;
                accessToken = response.AccessToken;
                localState.Assign(
                    response.SessionId,
                    response.DeviceId,
                    response.ParticipantId,
                    response.Role);
                eventLog?.BeginSession(
                    response.SessionId,
                    response.DeviceId,
                    StudyProtocol.AppBuildId);
                eventLog?.Append("DEVICE_ENROLLED", new
                {
                    response.DeviceId,
                    response.ParticipantId,
                    response.Role,
                    headsetModel = SystemInfo.deviceModel,
                    protocolVersion = StudyProtocol.ProtocolVersion,
                    appBuildId = StudyProtocol.AppBuildId
                });
                status.IsPaired = true;
                status.DeviceId = response.DeviceId;
                status.ParticipantId = response.ParticipantId;
                status.Role = response.Role;
                status.SessionId = response.SessionId;
                PublishStatus();
                ConnectSocket();
            }
        }

        private async void ConnectSocket()
        {
            if (enrollment == null || string.IsNullOrWhiteSpace(accessToken) ||
                applicationQuitting)
            {
                return;
            }

            if (socket != null &&
                (socket.State == WebSocketState.Open ||
                 socket.State == WebSocketState.Connecting))
            {
                return;
            }

            SetPhase(StudyClientPhase.Connecting, "Connecting to the study server…");
            Dictionary<string, string> headers = new Dictionary<string, string>
            {
                { "Authorization", $"Bearer {accessToken}" }
            };
            WebSocket nextSocket = new WebSocket(enrollment.WebsocketUrl, headers);
            socket = nextSocket;
            nextSocket.OnOpen += HandleSocketOpened;
            nextSocket.OnMessage += bytes => HandleSocketMessage(
                Encoding.UTF8.GetString(bytes));
            nextSocket.OnError += error => HandleSocketError(error);
            nextSocket.OnClose += code => HandleSocketClosed(code.ToString());

            try
            {
                await nextSocket.Connect();
            }
            catch (Exception exception)
            {
                if (socket == nextSocket)
                {
                    HandleSocketError(exception.Message);
                    HandleSocketClosed("connect_failed");
                }
            }
        }

        private void HandleSocketOpened()
        {
            double now = Time.realtimeSinceStartupAsDouble;
            lastServerMessageAt = now;
            nextHeartbeatAt = now;
            reconnectAttempt = 0;
            livenessReconnectRequested = false;
            heartbeatSentAt.Clear();
            SetPhase(StudyClientPhase.Synchronizing, "Applying the authoritative server snapshot…");
            eventLog?.Append("SOCKET_CONNECTED", new
            {
                recovered = disconnectedAt >= 0d,
                disconnectedMilliseconds = disconnectedAt < 0d
                    ? 0d
                    : (now - disconnectedAt) * 1000d
            });
        }

        private void HandleSocketError(string error)
        {
            eventLog?.Append("SOCKET_ERROR", new { detail = error });
        }

        private void HandleSocketClosed(string detail)
        {
            if (applicationQuitting || !status.IsPaired)
            {
                return;
            }

            if (disconnectedAt < 0d)
            {
                disconnectedAt = Time.realtimeSinceStartupAsDouble;
            }

            heartbeatSentAt.Clear();
            safetyController?.PreserveLastValidState();
            SetPhase(
                localCriticalFaultRaised
                    ? StudyClientPhase.Faulted
                    : StudyClientPhase.Recovering,
                localCriticalFaultRaised
                    ? "Technical pause — please wait for the researcher."
                    : "Connection interrupted. Waiting for recovery…");
            eventLog?.Append("SOCKET_DISCONNECTED", new { detail });
            if (reconnectRoutine == null)
            {
                reconnectRoutine = StartCoroutine(ReconnectRoutine());
            }
        }

        private IEnumerator ReconnectRoutine()
        {
            while (!applicationQuitting && status.IsPaired)
            {
                if (socket != null && socket.State == WebSocketState.Open)
                {
                    reconnectRoutine = null;
                    yield break;
                }

                float delay = ReconnectPolicy.RetryDelaySeconds(reconnectAttempt);
                reconnectAttempt += 1;
                yield return new WaitForSecondsRealtime(delay);
                if (socket == null || socket.State == WebSocketState.Closed)
                {
                    ConnectSocket();
                }
            }

            reconnectRoutine = null;
        }

        private async void HandleSocketMessage(string rawMessage)
        {
            lastServerMessageAt = Time.realtimeSinceStartupAsDouble;
            MessageEnvelope message;
            try
            {
                message = ProtocolJson.Deserialize<MessageEnvelope>(rawMessage);
            }
            catch (Exception exception)
            {
                eventLog?.Append("MESSAGE_REJECTED", new
                {
                    reason = "INVALID_JSON",
                    detail = exception.Message
                });
                return;
            }

            CommandValidationResult decision = commandValidator.Validate(message);
            if (decision.Action == CommandValidationAction.ReturnPriorResponse)
            {
                await SendRawAsync(decision.PriorResponseJson);
                return;
            }

            if (decision.Action == CommandValidationAction.Reject)
            {
                eventLog?.Append("MESSAGE_REJECTED", new
                {
                    reason = decision.Reason,
                    message.Type,
                    message.CommandId
                });
                await SendFaultAsync(decision.Reason, true);
                return;
            }

            try
            {
                await ProcessAcceptedMessageAsync(message);
            }
            catch (Exception exception)
            {
                eventLog?.Append("COMMAND_FAILED", new
                {
                    message.Type,
                    message.CommandId,
                    detail = exception.Message
                });
                await SendFaultAsync(exception.Message, true);
            }
        }

        private async Task ProcessAcceptedMessageAsync(MessageEnvelope message)
        {
            switch (message.Type)
            {
                case "HEARTBEAT_ACK":
                    HandleHeartbeatAcknowledgement(message);
                    return;
                case "STATE_SNAPSHOT":
                    await ApplySnapshotAsync(message);
                    return;
                case "BEGIN_CALIBRATION":
                    if (calibrationManager == null)
                    {
                        throw new InvalidOperationException(
                            "The Phase 5 AprilTag calibration runtime is missing.");
                    }
                    string attemptId =
                        message.Payload.Value<string>("attemptId") ?? string.Empty;
                    int durationMs =
                        message.Payload.Value<int?>("durationMs") ?? 0;
                    string thresholdProfile =
                        message.Payload.Value<string>("thresholdProfile") ?? string.Empty;
                    if (!string.Equals(
                            thresholdProfile,
                            AprilTagRigSolver.ProvisionalThresholdProfile,
                            StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException(
                            $"Calibration threshold profile mismatch: server requested " +
                            $"{thresholdProfile}, app requires " +
                            $"{AprilTagRigSolver.ProvisionalThresholdProfile}.");
                    }
                    SetPhase(
                        StudyClientPhase.Calibrating,
                        "Calibration in progress. Slowly look from the keyboard to the TV.");
                    CalibrationReportPayload report =
                        await calibrationManager.RunCalibrationAsync(
                            attemptId,
                            durationMs / 1000f);
                    eventLog?.Append("CALIBRATION_COMPLETED", report);
                    SetPhase(
                        StudyClientPhase.Waiting,
                        report.Status == "PASS"
                            ? "Calibration passed. Please wait for the researcher."
                            : "Calibration needs attention. Please wait for the researcher.");
                    await ReplyAndCacheAsync(
                        message,
                        "CALIBRATION_REPORT",
                        JObject.FromObject(report));
                    return;
                case "PREPARE_TRIAL":
                    string requiredCalibrationStatus =
                        message.Payload.Value<string>("calibrationStatus") ??
                        calibrationManager?.LastReport?.Status ??
                        "NOT_RUN";
                    string overrideReason =
                        message.Payload.Value<string>("calibrationOverrideReason");
                    bool calibrationReady =
                        requiredCalibrationStatus == "PASS" ||
                        requiredCalibrationStatus == "OVERRIDDEN";
                    bool drEnabled =
                        message.Payload.Value<bool?>("drEnabled") ?? false;
                    string drTarget =
                        message.Payload.Value<string>("drTarget") ?? string.Empty;
                    string drProfileVersion =
                        message.Payload.Value<string>("drProfileVersion") ?? string.Empty;
                    string drReason = string.Empty;
                    bool drPrepared = diminishedRealityManager != null &&
                                      diminishedRealityManager.PrepareTrial(
                                          drEnabled,
                                          drTarget,
                                          drProfileVersion,
                                          requiredCalibrationStatus,
                                          calibrationManager?.LastReport,
                                          out drReason);
                    DiminishedRealityStateReportPayload preparedDrState =
                        diminishedRealityManager?.ReportState("PREPARE") ??
                        MissingDiminishedRealityState("PREPARE", drEnabled, drTarget);
                    bool ready = calibrationReady && drPrepared &&
                                 preparedDrState.DrStateMatches;
                    JArray readinessReasons = new JArray();
                    if (!calibrationReady)
                    {
                        readinessReasons.Add(
                            "A passing calibration report or recorded override is required.");
                    }
                    if (!drPrepared || !preparedDrState.DrStateMatches)
                    {
                        readinessReasons.Add(string.IsNullOrWhiteSpace(drReason)
                            ? "The requested diminished-reality state was not prepared."
                            : drReason);
                    }
                    if (ready)
                    {
                        localState.ApplyState(
                            message.StateVersion,
                            "TRIAL_PREPARED",
                            message.TrialId,
                            false);
                        status.LastAppliedStateVersion = message.StateVersion;
                        SetPhase(StudyClientPhase.Prepared, "Trial prepared. Please wait.");
                    }
                    eventLog?.Append("DR_STATE_APPLIED", preparedDrState);
                    await ReplyAndCacheAsync(message, "READY", new JObject
                    {
                        ["readiness"] = ready ? "READY" : "NOT_READY",
                        ["calibrationStatus"] = requiredCalibrationStatus,
                        ["calibrationOverrideReason"] =
                            requiredCalibrationStatus == "OVERRIDDEN"
                                ? overrideReason
                                : null,
                        ["drStateMatches"] = preparedDrState.DrStateMatches,
                        ["drState"] = JObject.FromObject(preparedDrState),
                        ["appVersion"] = StudyProtocol.AppBuildId,
                        ["deviceStatus"] = ready
                            ? "PHASE6_DR_PREPARED"
                            : "PHASE6_NOT_READY",
                        ["reasons"] = readinessReasons
                    });
                    return;
                case "COMMIT_START":
                    string showReason;
                    if (diminishedRealityManager == null)
                    {
                        showReason = "The Phase 6 diminished-reality runtime is missing.";
                    }
                    else if (diminishedRealityManager.Show(out showReason))
                    {
                        showReason = string.Empty;
                    }
                    if (!string.IsNullOrWhiteSpace(showReason))
                    {
                        throw new InvalidOperationException(showReason);
                    }
                    DiminishedRealityStateReportPayload startedDrState =
                        diminishedRealityManager.ReportState("SHOW");
                    if (!startedDrState.DrStateMatches)
                    {
                        throw new InvalidOperationException(
                            "The actual DR state did not match the committed trial state.");
                    }
                    localState.ApplyState(
                        message.StateVersion,
                        "TRIAL_ACTIVE",
                        message.TrialId,
                        false);
                    status.LastAppliedStateVersion = message.StateVersion;
                    SetPhase(StudyClientPhase.Active, "Trial active.");
                    eventLog?.Append("DR_STATE_APPLIED", startedDrState);
                    await ReplyAndCacheAsync(message, "STARTED", new JObject
                    {
                        ["appliedStateVersion"] = message.StateVersion,
                        ["drState"] = JObject.FromObject(startedDrState)
                    });
                    return;
                case "STOP_TRIAL":
                    string outcome = message.Payload.Value<string>("outcome") ?? string.Empty;
                    localState.ApplyState(
                        message.StateVersion,
                        "POST_TRIAL",
                        message.TrialId,
                        false);
                    status.LastAppliedStateVersion = message.StateVersion;
                    if (outcome == "TECHNICAL_INVALID")
                    {
                        EnterLocalFailSafe("server_technical_invalidation");
                    }
                    else
                    {
                        diminishedRealityManager?.Hide();
                        safetyController?.ExitFailSafeAfterAuthoritativeContinuation();
                        localCriticalFaultRaised = false;
                        SetPhase(StudyClientPhase.Waiting, "Please wait for the researcher.");
                    }
                    await ReplyAndCacheAsync(message, "STOPPED", new JObject
                    {
                        ["outcome"] = outcome,
                        ["appliedStateVersion"] = message.StateVersion,
                        ["drState"] = JObject.FromObject(
                            diminishedRealityManager?.ReportState("HIDE") ??
                            MissingDiminishedRealityState("HIDE", false, null))
                    });
                    return;
                case "CONTINUE_AFTER_RECOVERY":
                    int continuedStateVersion =
                        message.Payload.Value<int?>("snapshotStateVersion") ?? -1;
                    string continuedSnapshotHash =
                        message.Payload.Value<string>("snapshotHash") ?? string.Empty;
                    if (!localState.MatchesPendingSnapshot(
                            continuedStateVersion,
                            continuedSnapshotHash))
                    {
                        throw new InvalidOperationException(
                            "Continuation does not match the validated pending snapshot.");
                    }

                    localState.ConfirmContinuation();
                    disconnectedAt = -1d;
                    localCriticalFaultRaised = false;
                    safetyController?.ExitFailSafeAfterAuthoritativeContinuation();
                    ApplyPendingSnapshotDrState();
                    SetPhase(
                        localState.LaptopState == "TRIAL_ACTIVE"
                            ? StudyClientPhase.Active
                            : StudyClientPhase.Waiting,
                        localState.LaptopState == "TRIAL_ACTIVE"
                            ? "Trial active."
                            : "Please wait for the researcher.");
                    await ReplyAndCacheAsync(message, "CONTINUED", new JObject
                    {
                        ["appliedStateVersion"] = localState.LastAppliedStateVersion,
                        ["snapshotHash"] = localState.LastAppliedSnapshotHash
                    });
                    return;
                case "DR_PREVIEW":
                    await HandleDiminishedRealityPreviewAsync(message);
                    return;
                case "REQUEST_LOCAL_LOG_STATUS":
                    RequireCurrentSession(message);
                    eventLog?.Append("LOCAL_LOG_STATUS_PREPARED", new
                    {
                        message.CommandId
                    });
                    await ReplyAndCacheAsync(
                        message,
                        "LOCAL_LOG_STATUS",
                        LocalLogPayload(eventLog?.GetManifest()),
                        false);
                    return;
                case "CLEANUP_LOCAL_LOG":
                    string cleanupSessionId = RequireCurrentSession(message);
                    string expectedSha256 =
                        message.Payload.Value<string>("expectedSha256") ?? string.Empty;
                    bool deleted = eventLog?.DeleteCurrentSessionLog(
                        cleanupSessionId,
                        expectedSha256) ?? false;
                    if (!deleted)
                    {
                        throw new InvalidOperationException(
                            "Local log cleanup was refused because the session or checksum did not match.");
                    }

                    await ReplyAndCacheAsync(message, "LOCAL_LOG_CLEANED", new JObject
                    {
                        ["sessionId"] = cleanupSessionId,
                        ["deleted"] = true
                    });
                    return;
                default:
                    throw new InvalidOperationException(
                        $"Unsupported server message type: {message.Type}.");
            }
        }

        private async Task ApplySnapshotAsync(MessageEnvelope message)
        {
            JObject snapshot = message.Payload["snapshot"] as JObject ??
                               throw new InvalidOperationException(
                                   "STATE_SNAPSHOT has no snapshot object.");
            string expectedHash = message.Payload.Value<string>("snapshotHash") ?? string.Empty;
            string actualHash = ProtocolJson.ComputeCanonicalSha256(snapshot);
            if (!string.Equals(expectedHash, actualHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("STATE_SNAPSHOT hash mismatch.");
            }

            string laptopState = snapshot.Value<string>("laptopState") ?? string.Empty;
            string activeTrialId = snapshot.Value<string>("activeTrialId") ?? string.Empty;
            ValidateSnapshotIdentity(snapshot, message.StateVersion);
            bool failSafeRequired = snapshot.Value<bool?>("failSafeRequired") ?? false;
            bool continuationRequired =
                snapshot.Value<bool?>("reconnectConfirmationRequired") ?? false;
            localState.ApplySnapshot(
                message.StateVersion,
                laptopState,
                activeTrialId,
                continuationRequired,
                actualHash);
            status.LastAppliedStateVersion = message.StateVersion;

            if (failSafeRequired)
            {
                pendingSnapshotDrState = null;
                EnterLocalFailSafe("authoritative_snapshot_fail_safe");
            }
            else if (continuationRequired)
            {
                pendingSnapshotDrState = (JObject)snapshot.DeepClone();
                safetyController?.PreserveLastValidState();
                SetPhase(
                    StudyClientPhase.Recovering,
                    "State restored. Waiting for researcher confirmation…");
            }
            else
            {
                ApplyAuthoritativeDrState(snapshot);
                pendingSnapshotDrState = null;
                disconnectedAt = -1d;
                localCriticalFaultRaised = false;
                safetyController?.ExitFailSafeAfterAuthoritativeContinuation();
                SetPhase(PhaseFromLaptopState(laptopState), DetailFromLaptopState(laptopState));
            }

            eventLog?.Append("STATE_SNAPSHOT_APPLIED", new
            {
                stateVersion = message.StateVersion,
                snapshotHash = actualHash,
                continuationRequired,
                failSafeRequired
            });
            await ReplyAndCacheAsync(message, "STATE_SNAPSHOT_APPLIED", new JObject
            {
                ["appliedStateVersion"] = message.StateVersion,
                ["snapshotHash"] = actualHash,
                ["drState"] = JObject.FromObject(
                    diminishedRealityManager?.ReportState("SNAPSHOT") ??
                    MissingDiminishedRealityState("SNAPSHOT", false, null))
            });
        }

        private async Task HandleDiminishedRealityPreviewAsync(MessageEnvelope message)
        {
            if (status.Phase == StudyClientPhase.Active ||
                localState.LaptopState == "TRIAL_ACTIVE")
            {
                throw new InvalidOperationException(
                    "Researcher DR preview is disabled during an active trial.");
            }
            if (diminishedRealityManager == null)
            {
                throw new InvalidOperationException(
                    "The Phase 6 diminished-reality runtime is missing.");
            }

            string action =
                message.Payload.Value<string>("action")?.ToUpperInvariant() ??
                string.Empty;
            string target =
                message.Payload.Value<string>("target")?.ToUpperInvariant() ??
                string.Empty;
            string profileVersion =
                message.Payload.Value<string>("profileVersion") ?? string.Empty;
            string reason = string.Empty;
            bool succeeded = true;
            switch (action)
            {
                case "PREPARE":
                    CalibrationReportPayload report = calibrationManager?.LastReport;
                    string calibrationGate = report?.Status ?? "NOT_RUN";
                    succeeded = diminishedRealityManager.PrepareTrial(
                        true,
                        target,
                        profileVersion,
                        calibrationGate,
                        report,
                        out reason);
                    break;
                case "SHOW":
                    succeeded = diminishedRealityManager.Show(out reason);
                    break;
                case "HIDE":
                    diminishedRealityManager.Hide();
                    break;
                case "REVEAL":
                    succeeded = diminishedRealityManager.Reveal(out reason);
                    break;
                case "SET_DEBUG_BOUNDS":
                    diminishedRealityManager.SetDebugBounds(
                        message.Payload.Value<bool?>("debugBounds") ?? false);
                    break;
                case "REPORT":
                    break;
                default:
                    throw new InvalidOperationException(
                        $"Unsupported DR preview action: {action}.");
            }

            DiminishedRealityStateReportPayload state =
                diminishedRealityManager.ReportState(action);
            if (!succeeded && string.IsNullOrWhiteSpace(state.Reason))
            {
                state.Reason = reason;
            }
            eventLog?.Append("DR_PREVIEW_STATE_REPORTED", state);
            await ReplyAndCacheAsync(
                message,
                "DR_STATE_REPORT",
                JObject.FromObject(state));
        }

        private void ApplyAuthoritativeDrState(JObject snapshot)
        {
            if (diminishedRealityManager == null)
            {
                throw new InvalidOperationException(
                    "The Phase 6 diminished-reality runtime is missing.");
            }

            string laptopState = snapshot.Value<string>("laptopState") ?? string.Empty;
            bool trialState = laptopState == "TRIAL_PREPARED" ||
                              laptopState == "TRIAL_COMMITTED" ||
                              laptopState == "TRIAL_ACTIVE";
            if (!trialState)
            {
                diminishedRealityManager.Hide();
                return;
            }

            JObject currentTrial = snapshot["currentTrial"] as JObject;
            string target = snapshot.Value<string>("drTarget") ??
                            currentTrial?.Value<string>("distractorType") ??
                            string.Empty;
            bool enabled = snapshot.Value<bool?>("drEnabled") ?? false;
            string profileVersion =
                snapshot.Value<string>("drProfileVersion") ?? string.Empty;
            string snapshotCalibrationStatus =
                snapshot.Value<string>("calibrationStatus") ??
                calibrationManager?.LastReport?.Status ??
                "NOT_RUN";
            if (!diminishedRealityManager.PrepareTrial(
                    enabled,
                    target,
                    profileVersion,
                    snapshotCalibrationStatus,
                    calibrationManager?.LastReport,
                    out string prepareReason))
            {
                throw new InvalidOperationException(prepareReason);
            }
            if (laptopState == "TRIAL_ACTIVE" &&
                !diminishedRealityManager.Show(out string showReason))
            {
                throw new InvalidOperationException(showReason);
            }
        }

        private void ApplyPendingSnapshotDrState()
        {
            if (pendingSnapshotDrState == null)
            {
                return;
            }
            JObject snapshot = pendingSnapshotDrState;
            pendingSnapshotDrState = null;
            ApplyAuthoritativeDrState(snapshot);
            eventLog?.Append(
                "DR_STATE_APPLIED_AFTER_RECOVERY",
                diminishedRealityManager?.ReportState("CONTINUE_AFTER_RECOVERY"));
        }

        private static DiminishedRealityStateReportPayload MissingDiminishedRealityState(
            string action,
            bool requestedEnabled,
            string target)
        {
            return new DiminishedRealityStateReportPayload
            {
                RequestedAction = action,
                Target = target,
                ProfileVersion = StudyProtocol.DrProfileVersion,
                RequestedEnabled = requestedEnabled,
                ActualState = "ERROR",
                Prepared = false,
                MaskVisible = false,
                DebugBoundsVisible = false,
                GeometryActive = false,
                CalibrationAttemptId = null,
                CalibrationStatus = "NOT_RUN",
                DrStateMatches = false,
                MeasuredFps = null,
                PerformanceTargetFps = 72,
                PerformanceGateEvaluated = false,
                PerformanceGatePass = null,
                Reason = "The Phase 6 diminished-reality runtime is missing."
            };
        }

        private void HandleHeartbeatAcknowledgement(MessageEnvelope message)
        {
            int sequence = message.Payload.Value<int?>("sequence") ?? -1;
            if (sequence >= 0 && heartbeatSentAt.TryGetValue(sequence, out double sentAt))
            {
                heartbeatSentAt.Remove(sequence);
                status.LastHeartbeatRoundTripMs = Math.Max(
                    0d,
                    Time.realtimeSinceStartupAsDouble * 1000d - sentAt);
            }

            PublishStatus();
        }

        private async Task SendHeartbeatAsync()
        {
            if (socket == null || socket.State != WebSocketState.Open ||
                enrollment == null)
            {
                return;
            }

            heartbeatSequence += 1;
            double sentAt = Time.realtimeSinceStartupAsDouble * 1000d;
            if (heartbeatSentAt.Count >= 32)
            {
                heartbeatSentAt.Remove(heartbeatSentAt.Keys.Min());
            }
            heartbeatSentAt[heartbeatSequence] = sentAt;
            MessageEnvelope heartbeat = CreateOutgoingEnvelope(
                Guid.NewGuid().ToString(),
                "HEARTBEAT",
                localState.ActiveTrialId,
                new JObject
                {
                    ["sequence"] = heartbeatSequence,
                    ["questState"] = QuestStateFromPhase(status.Phase),
                    ["lastAppliedStateVersion"] = localState.LastAppliedStateVersion
                });
            await SendRawAsync(ProtocolJson.Serialize(heartbeat));
        }

        private async Task ReplyAndCacheAsync(
            MessageEnvelope request,
            string responseType,
            JObject payload,
            bool recordAcknowledgement = true)
        {
            MessageEnvelope response = CreateOutgoingEnvelope(
                request.CommandId,
                responseType,
                request.TrialId,
                payload);
            response.StateVersion = request.StateVersion;
            string json = ProtocolJson.Serialize(response);
            await SendRawAsync(json);
            localState.CacheResponse(request.CommandId, json);
            if (recordAcknowledgement)
            {
                eventLog?.Append("COMMAND_ACKNOWLEDGED", new
                {
                    request.CommandId,
                    request.Type,
                    responseType,
                    stateVersion = request.StateVersion
                });
            }
        }

        private async Task SendFaultAsync(string detail, bool critical)
        {
            if (enrollment == null)
            {
                return;
            }

            string safeDetail = string.IsNullOrWhiteSpace(detail)
                ? "Quest client fault."
                : detail.Length <= 512
                    ? detail
                    : detail.Substring(0, 512);

            MessageEnvelope fault = CreateOutgoingEnvelope(
                Guid.NewGuid().ToString(),
                "FAULT",
                localState.ActiveTrialId,
                new JObject
                {
                    ["faultCode"] = FaultCodeFromDetail(safeDetail),
                    ["recoverable"] = !localCriticalFaultRaised,
                    ["firstObservedAtMonotonicMs"] =
                        Time.realtimeSinceStartupAsDouble * 1000d,
                    ["detail"] = safeDetail,
                    ["critical"] = critical
                });
            await SendRawAsync(ProtocolJson.Serialize(fault));
        }

        private async Task SendRawAsync(string json)
        {
            if (socket == null || socket.State != WebSocketState.Open ||
                string.IsNullOrWhiteSpace(json))
            {
                return;
            }

            await socket.SendText(json);
        }

        private MessageEnvelope CreateOutgoingEnvelope(
            string commandId,
            string type,
            string trialId,
            JObject payload)
        {
            return new MessageEnvelope
            {
                ProtocolVersion = StudyProtocol.ProtocolVersion,
                SessionId = localState.SessionId,
                TrialId = string.IsNullOrWhiteSpace(trialId) ? null : trialId,
                CommandId = commandId,
                StateVersion = localState.LastAppliedStateVersion,
                Sender = localState.DeviceId,
                Target = "SERVER",
                TimestampUtc = DateTime.UtcNow.ToString("O"),
                TimestampMonotonicMs = Time.realtimeSinceStartupAsDouble * 1000d,
                Type = type,
                Payload = payload ?? new JObject()
            };
        }

        private void EnterLocalFailSafe(string reason)
        {
            if (localCriticalFaultRaised)
            {
                return;
            }

            localCriticalFaultRaised = true;
            safetyController?.EnterClearPassthroughFailSafe(reason);
            eventLog?.Append("LOCAL_FAIL_SAFE_ENTERED", new { reason });
            SetPhase(
                StudyClientPhase.Faulted,
                "Technical pause — please wait for the researcher.");
            _ = SendFaultAsync(reason, true);
        }

        private JObject LocalLogPayload(LocalLogManifest manifest)
        {
            manifest = manifest ?? new LocalLogManifest();
            return new JObject
            {
                ["sessionId"] = string.IsNullOrWhiteSpace(manifest.SessionId)
                    ? localState.SessionId
                    : manifest.SessionId,
                ["retained"] = manifest.Retained,
                ["recordCount"] = manifest.RecordCount,
                ["sha256"] = string.IsNullOrWhiteSpace(manifest.Sha256)
                    ? JValue.CreateNull()
                    : manifest.Sha256
            };
        }

        private string RequireCurrentSession(MessageEnvelope message)
        {
            string requestedSessionId =
                message.Payload.Value<string>("sessionId") ?? string.Empty;
            if (requestedSessionId != localState.SessionId)
            {
                throw new InvalidOperationException(
                    "The local-log command targets a different session.");
            }

            return requestedSessionId;
        }

        private void ValidateSnapshotIdentity(JObject snapshot, int messageStateVersion)
        {
            int snapshotStateVersion = snapshot.Value<int?>("stateVersion") ?? -1;
            if (snapshotStateVersion != messageStateVersion)
            {
                throw new InvalidOperationException(
                    "STATE_SNAPSHOT state version does not match its envelope.");
            }

            JObject assignment = snapshot["assignment"] as JObject ??
                                 throw new InvalidOperationException(
                                     "STATE_SNAPSHOT has no assignment.");
            if (assignment.Value<string>("deviceId") != localState.DeviceId ||
                assignment.Value<string>("participantId") != localState.ParticipantId ||
                assignment.Value<string>("role") != localState.Role)
            {
                throw new InvalidOperationException(
                    "STATE_SNAPSHOT assignment does not match this enrollment.");
            }

            JToken currentTrial = snapshot["currentTrial"];
            JToken trialHash = snapshot["trialConfigurationHash"];
            if (currentTrial == null || currentTrial.Type == JTokenType.Null)
            {
                if (trialHash != null && trialHash.Type != JTokenType.Null)
                {
                    throw new InvalidOperationException(
                        "STATE_SNAPSHOT has a trial hash without a trial.");
                }

                return;
            }

            string expectedTrialHash = trialHash?.Value<string>() ?? string.Empty;
            string actualTrialHash = ProtocolJson.ComputeCanonicalSha256(currentTrial);
            if (!string.Equals(
                    expectedTrialHash,
                    actualTrialHash,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "STATE_SNAPSHOT trial configuration hash mismatch.");
            }
        }

        private static string FaultCodeFromDetail(string detail)
        {
            if (string.IsNullOrWhiteSpace(detail))
            {
                return "QUEST_CLIENT_FAULT";
            }

            StringBuilder builder = new StringBuilder();
            foreach (char character in detail.ToUpperInvariant())
            {
                if (char.IsLetterOrDigit(character) || character == '_')
                {
                    builder.Append(character);
                }
                else if (builder.Length > 0 && builder[builder.Length - 1] != '_')
                {
                    builder.Append('_');
                }

                if (builder.Length >= 64)
                {
                    break;
                }
            }

            string result = builder.ToString().Trim('_');
            if (result.Length < 2 || !char.IsLetter(result[0]))
            {
                return "QUEST_CLIENT_FAULT";
            }

            return result;
        }

        private bool ValidateEnrollmentResponse(
            EnrollmentResponse response,
            out string error)
        {
            if (response == null ||
                string.IsNullOrWhiteSpace(response.SessionId) ||
                string.IsNullOrWhiteSpace(response.DeviceId) ||
                string.IsNullOrWhiteSpace(response.ParticipantId) ||
                string.IsNullOrWhiteSpace(response.Role) ||
                string.IsNullOrWhiteSpace(response.AccessToken) ||
                string.IsNullOrWhiteSpace(response.WebsocketUrl))
            {
                error = "The server returned an incomplete enrollment.";
                return false;
            }

            if ((response.DeviceId != "QUEST_A" && response.DeviceId != "QUEST_B") ||
                (response.Role != "DIRECTOR" && response.Role != "BUILDER"))
            {
                error = "The server returned an invalid temporary slot or role.";
                return false;
            }

            if (!ProtocolJson.AreProtocolVersionsCompatible(
                    StudyProtocol.ProtocolVersion,
                    response.ProtocolVersion))
            {
                error = $"Protocol mismatch: Quest {StudyProtocol.ProtocolVersion}, server {response.ProtocolVersion}.";
                return false;
            }

            if (response.ApprovedQuestBuildId != StudyProtocol.AppBuildId)
            {
                error = $"App build mismatch: this APK is {StudyProtocol.AppBuildId}.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private void SetPhase(StudyClientPhase phase, string detail)
        {
            status.Phase = phase;
            status.Detail = detail ?? string.Empty;
            PublishStatus();
        }

        private void PublishStatus()
        {
            status.IsFailSafeActive = safetyController?.IsFailSafeActive ?? false;
            status.LastAppliedStateVersion = localState.LastAppliedStateVersion;
            StatusChanged?.Invoke(status.Copy());
        }

        private static StudyClientPhase PhaseFromLaptopState(string laptopState)
        {
            switch (laptopState)
            {
                case "TRIAL_PREPARED":
                case "TRIAL_COMMITTED":
                    return StudyClientPhase.Prepared;
                case "TRIAL_ACTIVE":
                    return StudyClientPhase.Active;
                case "RECOVERY_REQUIRED":
                    return StudyClientPhase.Faulted;
                default:
                    return StudyClientPhase.Waiting;
            }
        }

        private static string DetailFromLaptopState(string laptopState)
        {
            return laptopState == "TRIAL_ACTIVE"
                ? "Trial active."
                : "Please wait for the researcher.";
        }

        private static string QuestStateFromPhase(StudyClientPhase phase)
        {
            switch (phase)
            {
                case StudyClientPhase.Synchronizing:
                    return "SYNCHRONIZING";
                case StudyClientPhase.Prepared:
                    return "TRIAL_PREPARED";
                case StudyClientPhase.Active:
                    return "TRIAL_ACTIVE";
                case StudyClientPhase.Recovering:
                    return "RECOVERING";
                case StudyClientPhase.Faulted:
                    return "FAULTED";
                case StudyClientPhase.Waiting:
                    return "IDLE";
                case StudyClientPhase.Calibrating:
                    return "CALIBRATING";
                default:
                    return "CONNECTING";
            }
        }

        private static bool TryNormalizeServerAddress(
            string input,
            out string normalized,
            out string error)
        {
            string value = input?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(value))
            {
                normalized = string.Empty;
                error = "Enter the MacBook IPv4 address.";
                return false;
            }

            if (!value.Contains("://"))
            {
                value = $"http://{value}";
            }

            if (!Uri.TryCreate(value, UriKind.Absolute, out Uri uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                normalized = string.Empty;
                error = "Enter a valid HTTP server address.";
                return false;
            }

            int port = uri.IsDefaultPort ? StudyProtocol.DefaultServerPort : uri.Port;
            normalized = $"{uri.Scheme}://{uri.Host}:{port}";
            error = string.Empty;
            return true;
        }

        private static string LoadOrCreateClientInstanceId()
        {
            const string key = "CollaborativeDR.ClientInstanceId";
            string value = PlayerPrefs.GetString(key, string.Empty);
            if (!Guid.TryParse(value, out _))
            {
                value = Guid.NewGuid().ToString();
                PlayerPrefs.SetString(key, value);
                PlayerPrefs.Save();
            }

            return value;
        }

        private void StopConnectionLoops()
        {
            if (enrollmentRoutine != null)
            {
                StopCoroutine(enrollmentRoutine);
                enrollmentRoutine = null;
            }

            if (reconnectRoutine != null)
            {
                StopCoroutine(reconnectRoutine);
                reconnectRoutine = null;
            }
        }

        private async Task CloseSocketAsync()
        {
            WebSocket current = socket;
            socket = null;
            if (current != null &&
                (current.State == WebSocketState.Open ||
                 current.State == WebSocketState.Connecting))
            {
                try
                {
                    await current.Close();
                }
                catch (Exception)
                {
                    // Shutdown is best effort; the local log remains retained.
                }
            }
        }

        private async Task RestartSocketAfterLivenessTimeoutAsync()
        {
            await CloseSocketAsync();
            if (!applicationQuitting && status.IsPaired && disconnectedAt < 0d)
            {
                HandleSocketClosed("server_heartbeat_timeout");
            }
        }

        private async void OnApplicationQuit()
        {
            applicationQuitting = true;
            StopConnectionLoops();
            await CloseSocketAsync();
        }

        private void OnDestroy()
        {
            if (instance == this)
            {
                instance = null;
            }
        }
    }
}
