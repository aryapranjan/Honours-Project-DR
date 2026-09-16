using CollaborativeDR.StudyCore;

namespace CollaborativeDR.Protocol
{
    public enum CommandValidationAction
    {
        Accept,
        ReturnPriorResponse,
        Reject
    }

    public sealed class CommandValidationResult
    {
        public CommandValidationAction Action { get; private set; }
        public string PriorResponseJson { get; private set; }
        public string Reason { get; private set; }

        public static CommandValidationResult Accept()
        {
            return new CommandValidationResult
            {
                Action = CommandValidationAction.Accept
            };
        }

        public static CommandValidationResult Prior(string responseJson)
        {
            return new CommandValidationResult
            {
                Action = CommandValidationAction.ReturnPriorResponse,
                PriorResponseJson = responseJson
            };
        }

        public static CommandValidationResult Reject(string reason)
        {
            return new CommandValidationResult
            {
                Action = CommandValidationAction.Reject,
                Reason = reason
            };
        }
    }

    public sealed class CommandValidator
    {
        private readonly LocalStudyState localState;

        public CommandValidator(LocalStudyState localState)
        {
            this.localState = localState;
        }

        public CommandValidationResult Validate(MessageEnvelope message)
        {
            if (message == null)
            {
                return CommandValidationResult.Reject("EMPTY_MESSAGE");
            }

            if (!ProtocolJson.AreProtocolVersionsCompatible(
                    StudyProtocol.ProtocolVersion,
                    message.ProtocolVersion))
            {
                return CommandValidationResult.Reject("INCOMPATIBLE_PROTOCOL");
            }

            if (message.SessionId != localState.SessionId ||
                message.Sender != "SERVER" ||
                message.Target != localState.DeviceId)
            {
                return CommandValidationResult.Reject("ENVELOPE_IDENTITY_MISMATCH");
            }

            if (localState.TryGetCachedResponse(
                    message.CommandId,
                    out string responseJson))
            {
                return CommandValidationResult.Prior(responseJson);
            }

            if (message.Type != "STATE_SNAPSHOT" &&
                message.StateVersion < localState.LastAppliedStateVersion)
            {
                return CommandValidationResult.Reject("STALE_STATE_VERSION");
            }

            return CommandValidationResult.Accept();
        }
    }
}
