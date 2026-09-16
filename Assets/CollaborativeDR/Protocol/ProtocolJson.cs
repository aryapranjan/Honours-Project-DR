using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CollaborativeDR.Protocol
{
    public static class ProtocolJson
    {
        private static readonly JsonSerializerSettings Settings =
            new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Include,
                Formatting = Formatting.None
            };

        public static string Serialize(object value)
        {
            return JsonConvert.SerializeObject(value, Settings);
        }

        public static T Deserialize<T>(string json) where T : class
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("JSON cannot be empty.", nameof(json));
            }

            return JsonConvert.DeserializeObject<T>(json, Settings) ??
                   throw new JsonSerializationException(
                       $"Could not deserialize {typeof(T).Name}.");
        }

        public static string ComputeCanonicalSha256(JToken token)
        {
            string canonical = SortToken(token).ToString(Formatting.None);
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(canonical));
                return string.Concat(hash.Select(value => value.ToString("x2")));
            }
        }

        public static bool AreProtocolVersionsCompatible(
            string localVersion,
            string remoteVersion)
        {
            return TryReadMajor(localVersion, out int localMajor) &&
                   TryReadMajor(remoteVersion, out int remoteMajor) &&
                   localMajor == remoteMajor;
        }

        private static bool TryReadMajor(string value, out int major)
        {
            major = 0;
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }

            string[] parts = value.Split('.');
            return parts.Length == 3 && int.TryParse(parts[0], out major);
        }

        private static JToken SortToken(JToken token)
        {
            if (token is JObject sourceObject)
            {
                JObject sorted = new JObject();
                foreach (JProperty property in sourceObject.Properties()
                             .OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    sorted.Add(property.Name, SortToken(property.Value));
                }

                return sorted;
            }

            if (token is JArray sourceArray)
            {
                return new JArray(sourceArray.Select(SortToken));
            }

            return token.DeepClone();
        }
    }
}
