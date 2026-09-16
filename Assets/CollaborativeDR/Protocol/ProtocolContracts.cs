using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CollaborativeDR.Protocol
{
    public static class StudyProtocol
    {
        public const string SchemaVersion = "1.4.0";
        public const string ProtocolVersion = "1.3.0";
        public const string AppBuildId = "cdr-phase6-dev-1";
        public const string DrProfileVersion = "PHASE6_TEST_V1";
        public const int DefaultServerPort = 4317;
        public const double HeartbeatIntervalSeconds = 0.5d;
        public const double CriticalDisconnectSeconds = 3d;
    }

    public sealed class EnrollmentRequest
    {
        [JsonProperty("pairingCode")]
        public string PairingCode { get; set; }

        [JsonProperty("clientInstanceId")]
        public string ClientInstanceId { get; set; }

        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; }

        [JsonProperty("appBuildId")]
        public string AppBuildId { get; set; }
    }

    public sealed class EnrollmentResponse
    {
        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("deviceId")]
        public string DeviceId { get; set; }

        [JsonProperty("participantId")]
        public string ParticipantId { get; set; }

        [JsonProperty("role")]
        public string Role { get; set; }

        [JsonProperty("accessToken")]
        public string AccessToken { get; set; }

        [JsonProperty("websocketUrl")]
        public string WebsocketUrl { get; set; }

        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; }

        [JsonProperty("approvedQuestBuildId")]
        public string ApprovedQuestBuildId { get; set; }
    }

    public sealed class MessageEnvelope
    {
        [JsonProperty("protocolVersion")]
        public string ProtocolVersion { get; set; }

        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("trialId")]
        public string TrialId { get; set; }

        [JsonProperty("commandId")]
        public string CommandId { get; set; }

        [JsonProperty("stateVersion")]
        public int StateVersion { get; set; }

        [JsonProperty("sender")]
        public string Sender { get; set; }

        [JsonProperty("target")]
        public string Target { get; set; }

        [JsonProperty("timestampUtc")]
        public string TimestampUtc { get; set; }

        [JsonProperty("timestampMonotonicMs")]
        public double TimestampMonotonicMs { get; set; }

        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("payload")]
        public JObject Payload { get; set; } = new JObject();
    }

    [Serializable]
    public sealed class CalibrationVector3Payload
    {
        [JsonProperty("x")]
        public float X { get; set; }

        [JsonProperty("y")]
        public float Y { get; set; }

        [JsonProperty("z")]
        public float Z { get; set; }
    }

    [Serializable]
    public sealed class CalibrationQuaternionPayload
    {
        [JsonProperty("x")]
        public float X { get; set; }

        [JsonProperty("y")]
        public float Y { get; set; }

        [JsonProperty("z")]
        public float Z { get; set; }

        [JsonProperty("w")]
        public float W { get; set; }
    }

    [Serializable]
    public sealed class CalibrationPosePayload
    {
        [JsonProperty("position")]
        public CalibrationVector3Payload Position { get; set; }

        [JsonProperty("rotation")]
        public CalibrationQuaternionPayload Rotation { get; set; }
    }

    [Serializable]
    public sealed class CalibrationTagSamplePayload
    {
        [JsonProperty("tagId")]
        public int TagId { get; set; }

        [JsonProperty("acceptedCount")]
        public int AcceptedCount { get; set; }

        [JsonProperty("rejectedCount")]
        public int RejectedCount { get; set; }

        [JsonProperty("positionRmsMeters")]
        public float PositionRmsMeters { get; set; }

        [JsonProperty("rotationRmsDegrees")]
        public float RotationRmsDegrees { get; set; }
    }

    [Serializable]
    public sealed class CalibrationTagTransformPayload
    {
        [JsonProperty("tagId")]
        public int TagId { get; set; }

        [JsonProperty("poseInKeyboardRig")]
        public CalibrationPosePayload PoseInKeyboardRig { get; set; }
    }

    [Serializable]
    public sealed class CalibrationReportPayload
    {
        [JsonProperty("attemptId")]
        public string AttemptId { get; set; }

        [JsonProperty("status")]
        public string Status { get; set; }

        [JsonProperty("startedAtUtc")]
        public string StartedAtUtc { get; set; }

        [JsonProperty("completedAtUtc")]
        public string CompletedAtUtc { get; set; }

        [JsonProperty("durationMs")]
        public int DurationMs { get; set; }

        [JsonProperty("tagFamily")]
        public string TagFamily { get; set; }

        [JsonProperty("tagSizeMeters")]
        public float TagSizeMeters { get; set; }

        [JsonProperty("thresholdProfile")]
        public string ThresholdProfile { get; set; }

        [JsonProperty("cameraPosition")]
        public string CameraPosition { get; set; }

        [JsonProperty("imageWidth")]
        public int ImageWidth { get; set; }

        [JsonProperty("imageHeight")]
        public int ImageHeight { get; set; }

        [JsonProperty("observedTagIds")]
        public int[] ObservedTagIds { get; set; } = Array.Empty<int>();

        [JsonProperty("tagSamples")]
        public CalibrationTagSamplePayload[] TagSamples { get; set; } =
            Array.Empty<CalibrationTagSamplePayload>();

        [JsonProperty("acceptedObservationCount")]
        public int AcceptedObservationCount { get; set; }

        [JsonProperty("rejectedObservationCount")]
        public int RejectedObservationCount { get; set; }

        [JsonProperty("keyboardSpacingMeters")]
        public float? KeyboardSpacingMeters { get; set; }

        [JsonProperty("keyboardSpacingResidualMeters")]
        public float? KeyboardSpacingResidualMeters { get; set; }

        [JsonProperty("tvPlanarityRmsMeters")]
        public float? TvPlanarityRmsMeters { get; set; }

        [JsonProperty("keyboardRigInWorld")]
        public CalibrationPosePayload KeyboardRigInWorld { get; set; }

        [JsonProperty("tvInKeyboardRig")]
        public CalibrationPosePayload TvInKeyboardRig { get; set; }

        [JsonProperty("tagTransforms")]
        public CalibrationTagTransformPayload[] TagTransforms { get; set; } =
            Array.Empty<CalibrationTagTransformPayload>();

        [JsonProperty("failureReasons")]
        public string[] FailureReasons { get; set; } = Array.Empty<string>();

        [JsonProperty("warnings")]
        public string[] Warnings { get; set; } = Array.Empty<string>();

        [JsonProperty("rawFramesPersisted")]
        public bool RawFramesPersisted { get; set; }

        [JsonProperty("simulation")]
        public bool Simulation { get; set; }
    }

    [Serializable]
    public sealed class DiminishedRealityStateReportPayload
    {
        [JsonProperty("requestedAction")]
        public string RequestedAction { get; set; }

        [JsonProperty("target")]
        public string Target { get; set; }

        [JsonProperty("profileVersion")]
        public string ProfileVersion { get; set; }

        [JsonProperty("requestedEnabled")]
        public bool RequestedEnabled { get; set; }

        [JsonProperty("actualState")]
        public string ActualState { get; set; }

        [JsonProperty("prepared")]
        public bool Prepared { get; set; }

        [JsonProperty("maskVisible")]
        public bool MaskVisible { get; set; }

        [JsonProperty("debugBoundsVisible")]
        public bool DebugBoundsVisible { get; set; }

        [JsonProperty("geometryActive")]
        public bool GeometryActive { get; set; }

        [JsonProperty("calibrationAttemptId")]
        public string CalibrationAttemptId { get; set; }

        [JsonProperty("calibrationStatus")]
        public string CalibrationStatus { get; set; }

        [JsonProperty("drStateMatches")]
        public bool DrStateMatches { get; set; }

        [JsonProperty("measuredFps")]
        public float? MeasuredFps { get; set; }

        [JsonProperty("performanceTargetFps")]
        public int PerformanceTargetFps { get; set; }

        [JsonProperty("performanceGateEvaluated")]
        public bool PerformanceGateEvaluated { get; set; }

        [JsonProperty("performanceGatePass")]
        public bool? PerformanceGatePass { get; set; }

        [JsonProperty("reason")]
        public string Reason { get; set; }
    }
}
