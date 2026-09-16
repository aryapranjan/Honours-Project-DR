using System;

namespace CollaborativeDR.StudyCore
{
    public enum StudyClientPhase
    {
        Setup,
        Enrolling,
        Connecting,
        Synchronizing,
        Waiting,
        Calibrating,
        Prepared,
        Active,
        Recovering,
        Faulted
    }

    [Serializable]
    public sealed class StudyClientStatus
    {
        public StudyClientPhase Phase { get; set; } = StudyClientPhase.Setup;
        public string Detail { get; set; } = "Enter the laptop address and pairing code.";
        public string ServerAddress { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string ParticipantId { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public string HeadsetModel { get; set; } = string.Empty;
        public string ProtocolVersion { get; set; } = string.Empty;
        public string AppBuildId { get; set; } = string.Empty;
        public int LastAppliedStateVersion { get; set; }
        public double LastHeartbeatRoundTripMs { get; set; } = -1d;
        public bool IsPaired { get; set; }
        public bool IsFailSafeActive { get; set; }

        public StudyClientStatus Copy()
        {
            return (StudyClientStatus)MemberwiseClone();
        }
    }

    [Serializable]
    public sealed class LocalLogManifest
    {
        public string SessionId { get; set; } = string.Empty;
        public bool Retained { get; set; }
        public int RecordCount { get; set; }
        public string Sha256 { get; set; } = string.Empty;
        public string RelativePath { get; set; } = string.Empty;
    }

    public interface IVisualSafetyController
    {
        bool IsFailSafeActive { get; }
        void PreserveLastValidState();
        void EnterClearPassthroughFailSafe(string reason);
        void ExitFailSafeAfterAuthoritativeContinuation();
    }

    public interface IQuestEventLog
    {
        void BeginSession(string sessionId, string deviceId, string appBuildId);
        void Append(string eventType, object payload = null);
        LocalLogManifest GetManifest();
        bool DeleteCurrentSessionLog(string expectedSessionId, string expectedSha256);
    }
}
