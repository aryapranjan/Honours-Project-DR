using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using CollaborativeDR.StudyCore;
using Newtonsoft.Json;
using UnityEngine;

namespace CollaborativeDR.Telemetry
{
    [DisallowMultipleComponent]
    public sealed class QuestEventLogger : MonoBehaviour, IQuestEventLog
    {
        private const string RootDirectoryName = "CollaborativeDR";
        private const string EventsFileName = "quest-events.jsonl";
        private StreamWriter writer;
        private string currentSessionId = string.Empty;
        private string sessionDirectory = string.Empty;
        private int sequence;

        public void BeginSession(string sessionId, string deviceId, string appBuildId)
        {
            CloseWriter();
            currentSessionId = sessionId ?? string.Empty;
            string safeSessionId = SafePathSegment(sessionId);
            sessionDirectory = Path.Combine(
                Application.persistentDataPath,
                RootDirectoryName,
                safeSessionId);
            Directory.CreateDirectory(sessionDirectory);
            string eventsPath = Path.Combine(sessionDirectory, EventsFileName);
            sequence = File.Exists(eventsPath) ? File.ReadLines(eventsPath).Count() : 0;
            writer = new StreamWriter(eventsPath, true)
            {
                AutoFlush = true
            };
            Append("LOCAL_LOG_OPENED", new
            {
                deviceId,
                appBuildId,
                rawPcaFramesPersisted = false
            });
        }

        public void Append(string eventType, object payload = null)
        {
            if (writer == null)
            {
                return;
            }

            sequence += 1;
            string record = JsonConvert.SerializeObject(new
            {
                sequence,
                recordedAtUtc = DateTime.UtcNow.ToString("O"),
                recordedAtMonotonicMs = Time.realtimeSinceStartupAsDouble * 1000d,
                eventType,
                payload = payload ?? new { }
            }, Formatting.None);
            writer.WriteLine(record);
            writer.Flush();
        }

        public LocalLogManifest GetManifest()
        {
            if (string.IsNullOrWhiteSpace(sessionDirectory))
            {
                return new LocalLogManifest();
            }

            writer?.Flush();
            string eventsPath = Path.Combine(sessionDirectory, EventsFileName);
            if (!File.Exists(eventsPath))
            {
                return new LocalLogManifest();
            }

            using (FileStream stream = File.OpenRead(eventsPath))
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(stream);
                return new LocalLogManifest
                {
                    SessionId = currentSessionId,
                    Retained = true,
                    RecordCount = sequence,
                    Sha256 = string.Concat(hash.Select(value => value.ToString("x2"))),
                    RelativePath = $"{RootDirectoryName}/{Path.GetFileName(sessionDirectory)}/{EventsFileName}"
                };
            }
        }

        public bool DeleteCurrentSessionLog(
            string expectedSessionId,
            string expectedSha256)
        {
            if (string.IsNullOrWhiteSpace(sessionDirectory) ||
                string.IsNullOrWhiteSpace(expectedSessionId) ||
                expectedSessionId != currentSessionId ||
                string.IsNullOrWhiteSpace(expectedSha256))
            {
                return false;
            }

            LocalLogManifest manifest = GetManifest();
            if (!manifest.Retained ||
                !string.Equals(
                    manifest.Sha256,
                    expectedSha256,
                    StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string directory = sessionDirectory;
            CloseWriter();
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }

            currentSessionId = string.Empty;
            sessionDirectory = string.Empty;
            sequence = 0;
            return !Directory.Exists(directory);
        }

        private void OnDestroy()
        {
            CloseWriter();
        }

        private void CloseWriter()
        {
            writer?.Flush();
            writer?.Dispose();
            writer = null;
        }

        private static string SafePathSegment(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "unassigned";
            }

            char[] invalid = Path.GetInvalidFileNameChars()
                .Concat(new[] { '/', '\\' })
                .Distinct()
                .ToArray();
            string safe = value.Trim();
            foreach (char character in invalid)
            {
                safe = safe.Replace(character, '_');
            }

            return safe;
        }
    }
}
