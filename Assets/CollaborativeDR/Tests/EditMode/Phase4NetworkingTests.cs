using CollaborativeDR.Networking;
using CollaborativeDR.Protocol;
using CollaborativeDR.StudyCore;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace CollaborativeDR.Tests.EditMode
{
    public sealed class Phase4NetworkingTests
    {
        [TestCase(2999d, DisconnectAction.PreserveStateAndRecover)]
        [TestCase(3000d, DisconnectAction.PreserveStateAndRecover)]
        [TestCase(3001d, DisconnectAction.EnterFailSafe)]
        public void ReconnectPolicyUsesInclusiveThreeSecondRecoveryWindow(
            double durationMs,
            DisconnectAction expected)
        {
            Assert.That(ReconnectPolicy.Evaluate(durationMs), Is.EqualTo(expected));
        }

        [Test]
        public void ProtocolCompatibilityRequiresTheSameMajorVersion()
        {
            Assert.That(
                ProtocolJson.AreProtocolVersionsCompatible("1.1.0", "1.9.4"),
                Is.True);
            Assert.That(
                ProtocolJson.AreProtocolVersionsCompatible("1.1.0", "2.0.0"),
                Is.False);
            Assert.That(
                ProtocolJson.AreProtocolVersionsCompatible("1.1", "1.1.0"),
                Is.False);
        }

        [Test]
        public void CanonicalSnapshotHashDoesNotDependOnObjectKeyOrder()
        {
            JObject first = JObject.Parse(
                "{\"z\":2,\"nested\":{\"b\":2,\"a\":1},\"a\":1}");
            JObject second = JObject.Parse(
                "{\"a\":1,\"nested\":{\"a\":1,\"b\":2},\"z\":2}");

            Assert.That(
                ProtocolJson.ComputeCanonicalSha256(first),
                Is.EqualTo(ProtocolJson.ComputeCanonicalSha256(second)));
        }

        [Test]
        public void CommandValidatorReturnsTheCachedResponseForADuplicate()
        {
            LocalStudyState state = AssignedState();
            state.CacheResponse("command-1", "{\"prior\":true}");
            CommandValidator validator = new CommandValidator(state);

            CommandValidationResult result = validator.Validate(
                Envelope("command-1", 5));

            Assert.That(
                result.Action,
                Is.EqualTo(CommandValidationAction.ReturnPriorResponse));
            Assert.That(result.PriorResponseJson, Is.EqualTo("{\"prior\":true}"));
        }

        [Test]
        public void CommandValidatorRejectsStaleStateAndWrongIdentity()
        {
            LocalStudyState state = AssignedState();
            CommandValidator validator = new CommandValidator(state);

            CommandValidationResult stale = validator.Validate(
                Envelope("command-2", 4));
            MessageEnvelope wrongTarget = Envelope("command-3", 6);
            wrongTarget.Target = "QUEST_B";
            CommandValidationResult identity = validator.Validate(wrongTarget);

            Assert.That(stale.Action, Is.EqualTo(CommandValidationAction.Reject));
            Assert.That(stale.Reason, Is.EqualTo("STALE_STATE_VERSION"));
            Assert.That(identity.Action, Is.EqualTo(CommandValidationAction.Reject));
            Assert.That(identity.Reason, Is.EqualTo("ENVELOPE_IDENTITY_MISMATCH"));
        }

        [Test]
        public void ContinuationMustMatchThePendingSnapshotVersionAndHash()
        {
            LocalStudyState state = new LocalStudyState();
            state.Assign("session-1", "QUEST_A", "P001-A", "DIRECTOR");
            state.ApplySnapshot(
                7,
                "TRIAL_ACTIVE",
                "TRIAL-1",
                true,
                "abc123");

            Assert.That(state.MatchesPendingSnapshot(7, "abc123"), Is.True);
            Assert.That(state.MatchesPendingSnapshot(6, "abc123"), Is.False);
            Assert.That(state.MatchesPendingSnapshot(7, "different"), Is.False);

            state.ConfirmContinuation();
            Assert.That(state.MatchesPendingSnapshot(7, "abc123"), Is.False);
        }

        private static LocalStudyState AssignedState()
        {
            LocalStudyState state = new LocalStudyState();
            state.Assign("session-1", "QUEST_A", "P001-A", "DIRECTOR");
            state.ApplyState(5, "TRIAL_ACTIVE", "TRIAL-1", false);
            return state;
        }

        private static MessageEnvelope Envelope(string commandId, int stateVersion)
        {
            return new MessageEnvelope
            {
                ProtocolVersion = StudyProtocol.ProtocolVersion,
                SessionId = "session-1",
                TrialId = "TRIAL-1",
                CommandId = commandId,
                StateVersion = stateVersion,
                Sender = "SERVER",
                Target = "QUEST_A",
                TimestampUtc = "2026-08-10T00:00:00.000Z",
                TimestampMonotonicMs = 1000d,
                Type = "STOP_TRIAL",
                Payload = new JObject()
            };
        }
    }
}
