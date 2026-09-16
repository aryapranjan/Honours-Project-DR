namespace CollaborativeDR.Networking
{
    public enum DisconnectAction
    {
        PreserveStateAndRecover,
        EnterFailSafe
    }

    public static class ReconnectPolicy
    {
        public static DisconnectAction Evaluate(double disconnectedMilliseconds)
        {
            return disconnectedMilliseconds <= 3000d
                ? DisconnectAction.PreserveStateAndRecover
                : DisconnectAction.EnterFailSafe;
        }

        public static float RetryDelaySeconds(int attempt)
        {
            int boundedAttempt = attempt < 0 ? 0 : (attempt > 4 ? 4 : attempt);
            return 0.25f * (1 << boundedAttempt);
        }
    }
}
