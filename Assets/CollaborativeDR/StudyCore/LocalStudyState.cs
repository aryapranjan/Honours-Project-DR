using System.Collections.Generic;

namespace CollaborativeDR.StudyCore
{
    public sealed class LocalStudyState
    {
        private readonly Dictionary<string, string> commandResponses =
            new Dictionary<string, string>();
        private readonly Queue<string> commandOrder = new Queue<string>();

        public const int MaximumCachedCommandResponses = 128;

        public string SessionId { get; private set; } = string.Empty;
        public string DeviceId { get; private set; } = string.Empty;
        public string ParticipantId { get; private set; } = string.Empty;
        public string Role { get; private set; } = string.Empty;
        public string LaptopState { get; private set; } = string.Empty;
        public string ActiveTrialId { get; private set; } = string.Empty;
        public int LastAppliedStateVersion { get; private set; }
        public string LastAppliedSnapshotHash { get; private set; } = string.Empty;
        public bool SnapshotAppliedAwaitingContinuation { get; private set; }

        public void Assign(
            string sessionId,
            string deviceId,
            string participantId,
            string role)
        {
            SessionId = sessionId ?? string.Empty;
            DeviceId = deviceId ?? string.Empty;
            ParticipantId = participantId ?? string.Empty;
            Role = role ?? string.Empty;
        }

        public void ApplyState(
            int stateVersion,
            string laptopState,
            string activeTrialId,
            bool awaitingContinuation)
        {
            LastAppliedStateVersion = stateVersion;
            LaptopState = laptopState ?? string.Empty;
            ActiveTrialId = activeTrialId ?? string.Empty;
            SnapshotAppliedAwaitingContinuation = awaitingContinuation;
        }

        public void ApplySnapshot(
            int stateVersion,
            string laptopState,
            string activeTrialId,
            bool awaitingContinuation,
            string snapshotHash)
        {
            ApplyState(
                stateVersion,
                laptopState,
                activeTrialId,
                awaitingContinuation);
            LastAppliedSnapshotHash = snapshotHash ?? string.Empty;
        }

        public bool MatchesPendingSnapshot(int stateVersion, string snapshotHash)
        {
            return SnapshotAppliedAwaitingContinuation &&
                   stateVersion == LastAppliedStateVersion &&
                   !string.IsNullOrWhiteSpace(snapshotHash) &&
                   snapshotHash == LastAppliedSnapshotHash;
        }

        public void ConfirmContinuation()
        {
            SnapshotAppliedAwaitingContinuation = false;
        }

        public bool TryGetCachedResponse(string commandId, out string responseJson)
        {
            if (string.IsNullOrWhiteSpace(commandId))
            {
                responseJson = null;
                return false;
            }

            return commandResponses.TryGetValue(commandId, out responseJson);
        }

        public void CacheResponse(string commandId, string responseJson)
        {
            if (string.IsNullOrWhiteSpace(commandId) ||
                string.IsNullOrWhiteSpace(responseJson) ||
                commandResponses.ContainsKey(commandId))
            {
                return;
            }

            commandResponses.Add(commandId, responseJson);
            commandOrder.Enqueue(commandId);
            while (commandOrder.Count > MaximumCachedCommandResponses)
            {
                string oldest = commandOrder.Dequeue();
                commandResponses.Remove(oldest);
            }
        }

        public void ResetEnrollment()
        {
            SessionId = string.Empty;
            DeviceId = string.Empty;
            ParticipantId = string.Empty;
            Role = string.Empty;
            LaptopState = string.Empty;
            ActiveTrialId = string.Empty;
            LastAppliedStateVersion = 0;
            LastAppliedSnapshotHash = string.Empty;
            SnapshotAppliedAwaitingContinuation = false;
            commandResponses.Clear();
            commandOrder.Clear();
        }
    }
}
