using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using LiteDB;
using JsonSerializer = System.Text.Json.JsonSerializer;

namespace Vgcm.PlayniteReader;

internal static class Program
{
    private const string SchemaVersion = "vgcm-playnite-library-v1";
    private static readonly string[] RequiredFiles =
    {
        "ageratings.db", "categories.db", "companies.db", "completionstatuses.db",
        "database.json", "emulators.db", "features.db", "filterpresets.db",
        "games.db", "genres.db", "importexclusions.db", "platforms.db",
        "regions.db", "scanners.db", "series.db", "sources.db", "tags.db", "tools.db"
    };

    public static int Main(string[] args)
    {
        try
        {
            var options = Options.Parse(args);
            if (options.Serve)
            {
                return RunServer(options).GetAwaiter().GetResult();
            }
            using var source = LibrarySource.Open(options);
            var snapshot = BuildSnapshot(source, options);
            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                WriteIndented = options.Pretty
            };
            var json = JsonSerializer.Serialize(snapshot, jsonOptions);

            if (!string.IsNullOrWhiteSpace(options.OutputPath))
            {
                var outputPath = Path.GetFullPath(options.OutputPath);
                var parent = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                File.WriteAllText(outputPath, json, new UTF8Encoding(false));
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    ok = true,
                    schemaVersion = SchemaVersion,
                    outputPath,
                    snapshot.Source.FileName,
                    snapshot.Source.Fingerprint,
                    snapshot.Statistics.GameRecords,
                    snapshot.Statistics.ApprovedStorefrontRecords,
                    snapshot.Statistics.MissingSource,
                    snapshot.Statistics.MissingPlatform
                }, jsonOptions));
            }
            else
            {
                Console.WriteLine(json);
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                schemaVersion = SchemaVersion,
                error = ex.Message,
                errorType = ex.GetType().Name
            }));
            return 1;
        }
    }

    private static async Task<int> RunServer(Options options)
    {
        using var listener = new HttpListener();
        var dispatcher = new BoundedRequestDispatcher(options.MaximumConcurrentRequests);
        var snapshotFlight = new SingleFlight();
        var backupFlight = new SingleFlight();
        listener.Prefixes.Add(options.ListenUrl);
        listener.Start();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            schemaVersion = SchemaVersion,
            mode = "private-companion-http-service",
            spreadsheetBackupEnabled = !string.IsNullOrWhiteSpace(options.SpreadsheetBackupDirectory),
            listenUrl = options.ListenUrl
        }));

        async Task HandleRequest(HttpListenerContext context)
        {
            try
            {
                var path = context.Request.Url?.AbsolutePath.TrimEnd('/') ?? "";
                if (path.Equals("/spreadsheet-backup", StringComparison.OrdinalIgnoreCase) &&
                    context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
                {
                    using var backupLease = backupFlight.TryAcquire();
                    if (backupLease == null)
                    {
                        await WriteBusy(context.Response, "A spreadsheet backup is already in progress; no second write was started.");
                        return;
                    }
                    await WriteSpreadsheetBackup(context, options);
                    return;
                }

                if (!path.Equals("/snapshot", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteResponse(context.Response, 404, JsonSerializer.Serialize(new
                    {
                        ok = false,
                        error = "Use GET /health, GET /snapshot, or POST /spreadsheet-backup."
                    }));
                    return;
                }

                if (!context.Request.HttpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.Headers["Allow"] = "GET";
                    await WriteResponse(context.Response, 405, "{\"ok\":false,\"error\":\"Snapshot requires GET.\"}");
                    return;
                }
                using var snapshotLease = snapshotFlight.TryAcquire();
                if (snapshotLease == null)
                {
                    await WriteBusy(context.Response, "A snapshot build is already in progress; no duplicate read was started.");
                    return;
                }
                using var source = LibrarySource.Open(options);
                var snapshot = BuildSnapshot(source, options);
                var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
                });
                await WriteResponse(context.Response, 200, json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new
                {
                    ok = false,
                    schemaVersion = SchemaVersion,
                    stage = "request-handler",
                    method = context.Request.HttpMethod,
                    path = context.Request.Url?.AbsolutePath,
                    error = ex.Message,
                    errorType = ex.GetType().Name
                }));
                await WriteResponse(context.Response, 500, JsonSerializer.Serialize(new
                {
                    ok = false,
                    schemaVersion = SchemaVersion,
                    error = ex.Message,
                    errorType = ex.GetType().Name
                }));
            }
        }

        while (true)
        {
            var context = await listener.GetContextAsync();
            var path = context.Request.Url?.AbsolutePath.TrimEnd('/') ?? "";
            // Liveness has its own fast lane even when every expensive-request slot is busy.
            // It reports process health, not acceptance or freshness of the PC snapshot.
            if (path.Equals("/health", StringComparison.OrdinalIgnoreCase))
            {
                if (!context.Request.HttpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.Headers["Allow"] = "GET";
                    await WriteResponse(context.Response, 405, "{\"ok\":false,\"error\":\"Health requires GET.\"}");
                    continue;
                }
                await WriteResponse(context.Response, 200, JsonSerializer.Serialize(new
                {
                    ok = true,
                    schemaVersion = SchemaVersion,
                    mode = "private-companion-http-service",
                    snapshotInProgress = snapshotFlight.IsBusy,
                    spreadsheetBackupInProgress = backupFlight.IsBusy,
                    maximumConcurrentRequests = options.MaximumConcurrentRequests,
                    spreadsheetBackupEnabled = !string.IsNullOrWhiteSpace(options.SpreadsheetBackupDirectory)
                }));
                continue;
            }
            if (!dispatcher.TryDispatch(() => HandleRequest(context), ex =>
                Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = false, stage = "request-dispatch", error = ex.Message })), out _))
            {
                await WriteBusy(context.Response, "The bounded request limit is reached; no work was queued.");
            }
        }
    }

    private static Task WriteBusy(HttpListenerResponse response, string message)
    {
        response.Headers["Retry-After"] = "30";
        return WriteResponse(response, 409, JsonSerializer.Serialize(new { ok = false, errorType = "ReaderBusy", error = message }));
    }

    private static async Task WriteResponse(HttpListenerResponse response, int statusCode, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        try
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            await response.OutputStream.WriteAsync(bytes);
        }
        catch (Exception ex)
        {
            // A caller can time out or disconnect while a large snapshot is being built.
            // That transport failure must end only this response, never the server process.
            Console.Error.WriteLine(JsonSerializer.Serialize(new
            {
                ok = false,
                schemaVersion = SchemaVersion,
                stage = "response-write",
                statusCode,
                error = ex.Message,
                errorType = ex.GetType().Name
            }));
        }
        finally
        {
            try
            {
                response.Close();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(JsonSerializer.Serialize(new
                {
                    ok = false,
                    schemaVersion = SchemaVersion,
                    stage = "response-close",
                    statusCode,
                    error = ex.Message,
                    errorType = ex.GetType().Name
                }));
            }
        }
    }

    private static async Task WriteSpreadsheetBackup(HttpListenerContext context, Options options)
    {
        if (string.IsNullOrWhiteSpace(options.SpreadsheetBackupDirectory))
        {
            await WriteResponse(context.Response, 503, JsonSerializer.Serialize(new
            {
                ok = false,
                error = "Spreadsheet backup storage is not configured."
            }));
            return;
        }

        const long maximumBytes = 250L * 1024 * 1024;
        if (context.Request.ContentLength64 == 0 || context.Request.ContentLength64 > maximumBytes)
        {
            await WriteResponse(context.Response, 413, JsonSerializer.Serialize(new
            {
                ok = false,
                error = $"The workbook must be between 1 byte and {maximumBytes} bytes."
            }));
            return;
        }

        var requestedName = context.Request.Headers["X-VGCM-Backup-Name"] ?? "";
        var fileName = Path.GetFileName(requestedName.Trim());
        if (string.IsNullOrWhiteSpace(fileName) || !fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ||
            !fileName.Equals(requestedName.Trim(), StringComparison.Ordinal))
        {
            await WriteResponse(context.Response, 400, JsonSerializer.Serialize(new
            {
                ok = false,
                error = "X-VGCM-Backup-Name must be a plain .xlsx file name without a directory path."
            }));
            return;
        }

        var backupDirectory = Path.GetFullPath(options.SpreadsheetBackupDirectory);
        Directory.CreateDirectory(backupDirectory);
        var targetPath = Path.Combine(backupDirectory, fileName);
        var temporaryPath = targetPath + ".partial-" + Guid.NewGuid().ToString("N");
        long totalBytes = 0;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

        try
        {
            await using (var output = new FileStream(temporaryPath, System.IO.FileMode.CreateNew,
                             FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var buffer = new byte[81920];
                while (true)
                {
                    var read = await context.Request.InputStream.ReadAsync(buffer);
                    if (read == 0) break;
                    totalBytes += read;
                    if (totalBytes > maximumBytes)
                        throw new InvalidDataException($"The workbook exceeded the {maximumBytes}-byte limit.");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read));
                }
                await output.FlushAsync();
            }

            if (totalBytes == 0) throw new InvalidDataException("The workbook upload was empty.");
            if (File.Exists(targetPath)) throw new IOException("A backup with this exact name already exists.");
            File.Move(temporaryPath, targetPath);

            await WriteResponse(context.Response, 201, JsonSerializer.Serialize(new
            {
                ok = true,
                fileName,
                sizeBytes = totalBytes,
                sha256 = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
                createdAtUtc = DateTime.UtcNow
            }));
        }
        catch
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
            throw;
        }
    }

    private static Snapshot BuildSnapshot(LibrarySource source, Options options)
    {
        var sources = ReadNamedLookup(source.PathFor("sources.db"), "GameSource");
        var platforms = ReadNamedLookup(source.PathFor("platforms.db"), "Platform");
        var completionStatuses = ReadNamedLookup(source.PathFor("completionstatuses.db"), "CompletionStatus");
        var genres = ReadNamedLookup(source.PathFor("genres.db"), "Genre");
        var series = ReadNamedLookup(source.PathFor("series.db"), "Series");

        var records = new List<GameRecord>();
        using (var database = OpenReadOnly(source.PathFor("games.db")))
        {
            var collection = database.GetCollection("Game");
            foreach (var game in collection.Find(Query.All()))
            {
                var sourceId = ReadGuid(game, "SourceId");
                var sourceName = Lookup(sources, sourceId);
                var platformNames = ReadGuidArray(game, "PlatformIds")
                    .Select(id => Lookup(platforms, id) ?? id)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                    .ToArray();

                var name = ReadString(game, "Name") ?? "";
                var playniteId = ReadGuid(game, "_id") ?? "";
                var storefrontGameId = ReadString(game, "GameId") ?? "";
                var recordKey = BuildRecordKey(sourceId, storefrontGameId, playniteId);
                var releaseDate = ReadString(game, "ReleaseDate");

                records.Add(new GameRecord
                {
                    RecordKey = recordKey,
                    PlayniteId = playniteId,
                    StorefrontGameId = storefrontGameId,
                    PluginId = ReadGuid(game, "PluginId"),
                    SourceId = sourceId,
                    SourceName = sourceName,
                    Name = name,
                    ExactTitleKey = ExactTitleKey(name),
                    NormalizedTitle = NormalizeTitle(name),
                    Platforms = platformNames,
                    Genres = ResolveIds(game, "GenreIds", genres),
                    Series = ResolveIds(game, "SeriesIds", series),
                    CompletionStatus = Lookup(completionStatuses, ReadGuid(game, "CompletionStatusId"))
                        ?? ReadNestedName(game, "CompletionStatus"),
                    ReleaseDate = releaseDate,
                    ReleaseYear = ParseReleaseYear(releaseDate),
                    AddedUtc = ReadDate(game, "Added"),
                    ModifiedUtc = ReadDate(game, "Modified"),
                    LastActivityUtc = ReadDate(game, "LastActivity"),
                    Favorite = ReadBool(game, "Favorite"),
                    Hidden = ReadBool(game, "Hidden"),
                    Installed = ReadBool(game, "IsInstalled"),
                    PlaytimeSeconds = ReadLong(game, "Playtime"),
                    PlayCount = ReadLong(game, "PlayCount"),
                    InstallSizeBytes = ReadLong(game, "InstallSize"),
                    CriticScore = ReadDouble(game, "CriticScore"),
                    CommunityScore = ReadDouble(game, "CommunityScore"),
                    Links = ReadLinks(game)
                });
            }
        }

        records = records
            .OrderBy(record => record.SourceName ?? "", StringComparer.OrdinalIgnoreCase)
            .ThenBy(record => record.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(record => record.StorefrontGameId, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var bySource = records
            .GroupBy(record => record.SourceName ?? "Unclassified", StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        var sourceCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var knownSource in sources.Values.OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
        {
            sourceCounts[knownSource] = bySource.GetValueOrDefault(knownSource, 0);
        }
        if (bySource.TryGetValue("Unclassified", out var unclassified))
        {
            sourceCounts["Unclassified"] = unclassified;
        }

        var storefrontRecords = records.Count(record => !string.IsNullOrWhiteSpace(record.SourceName));
        var duplicateKeys = records
            .GroupBy(record => record.RecordKey, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .Take(20)
            .ToArray();
        if (duplicateKeys.Length > 0)
        {
            throw new InvalidDataException("Duplicate stable record keys were found: " + string.Join(", ", duplicateKeys));
        }

        if (records.Count < options.MinimumGameCount)
        {
            throw new InvalidDataException($"The Playnite library contained only {records.Count} game records; expected at least {options.MinimumGameCount}.");
        }
        if (sources.Count < 1 || platforms.Count < 1)
        {
            throw new InvalidDataException("The Playnite source or platform lookup was empty.");
        }

        return new Snapshot
        {
            SchemaVersion = SchemaVersion,
            GeneratedAtUtc = DateTime.UtcNow,
            Source = source.Describe(),
            Statistics = new SnapshotStatistics
            {
                GameRecords = records.Count,
                ApprovedStorefrontRecords = storefrontRecords,
                ExactTitleKeys = records.Select(record => record.ExactTitleKey).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                CandidateFamilyKeys = records.Select(record => record.NormalizedTitle).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                SourceDefinitions = sources.Count,
                PlatformDefinitions = platforms.Count,
                MissingSource = records.Count(record => string.IsNullOrWhiteSpace(record.SourceName)),
                MissingPlatform = records.Count(record => record.Platforms.Length == 0),
                BySource = sourceCounts
            },
            Records = records
        };
    }

    private static LiteDatabase OpenReadOnly(string path) => new(new ConnectionString
    {
        Filename = path,
        Mode = LiteDB.FileMode.ReadOnly
    });

    private static Dictionary<string, string> ReadNamedLookup(string path, string collectionName)
    {
        using var database = OpenReadOnly(path);
        return database.GetCollection(collectionName)
            .Find(Query.All())
            .Select(document => new { Id = ReadGuid(document, "_id"), Name = ReadString(document, "Name") })
            .Where(row => !string.IsNullOrWhiteSpace(row.Id) && !string.IsNullOrWhiteSpace(row.Name))
            .ToDictionary(row => row.Id!, row => row.Name!, StringComparer.OrdinalIgnoreCase);
    }

    private static string? Lookup(IReadOnlyDictionary<string, string> values, string? id) =>
        id != null && values.TryGetValue(id, out var value) ? value : null;

    private static string[] ResolveIds(BsonDocument document, string field, IReadOnlyDictionary<string, string> lookup) =>
        ReadGuidArray(document, field)
            .Select(id => Lookup(lookup, id) ?? id)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static string BuildRecordKey(string? sourceId, string storefrontGameId, string playniteId)
    {
        var stable = !string.IsNullOrWhiteSpace(storefrontGameId) ? storefrontGameId : playniteId;
        return $"{sourceId ?? "unclassified"}|{stable}".ToLowerInvariant();
    }

    private static string NormalizeTitle(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormKD).ToLowerInvariant();
        normalized = Regex.Replace(normalized, "[’'`´]", "");
        normalized = Regex.Replace(normalized, "[^a-z0-9]+", " ");
        normalized = Regex.Replace(normalized, "\\s+", " ").Trim();
        return normalized;
    }

    private static string ExactTitleKey(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormC).ToLowerInvariant();
        return Regex.Replace(normalized, "\\s+", " ").Trim();
    }

    private static int? ParseReleaseYear(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var match = Regex.Match(value, "(?<!\\d)(19|20)\\d{2}(?!\\d)");
        return match.Success && int.TryParse(match.Value, out var year) ? year : null;
    }

    private static string? ReadGuid(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key)) return null;
        var value = document[key];
        if (value == null || value.IsNull) return null;
        if (value.IsGuid) return value.AsGuid.ToString("D");
        var text = value.ToString().Trim('"');
        return Guid.TryParse(text, out var guid) ? guid.ToString("D") : null;
    }

    private static IEnumerable<string> ReadGuidArray(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key) || document[key] == null || !document[key].IsArray) yield break;
        foreach (var value in document[key].AsArray)
        {
            if (value.IsGuid) yield return value.AsGuid.ToString("D");
            else if (Guid.TryParse(value.ToString().Trim('"'), out var guid)) yield return guid.ToString("D");
        }
    }

    private static string? ReadString(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key)) return null;
        var value = document[key];
        if (value == null || value.IsNull) return null;
        return value.IsString ? value.AsString : value.ToString().Trim('"');
    }

    private static string? ReadNestedName(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key) || !document[key].IsDocument) return null;
        return ReadString(document[key].AsDocument, "Name");
    }

    private static DateTime? ReadDate(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key)) return null;
        var value = document[key];
        if (value == null || value.IsNull) return null;
        if (value.IsDateTime) return value.AsDateTime.ToUniversalTime();
        return DateTime.TryParse(value.ToString().Trim('"'), CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;
    }

    private static bool ReadBool(BsonDocument document, string key) =>
        document.ContainsKey(key) && document[key] != null && document[key].IsBoolean && document[key].AsBoolean;

    private static long ReadLong(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key)) return 0;
        var value = document[key];
        if (value == null || value.IsNull) return 0;
        if (value.IsInt32) return value.AsInt32;
        if (value.IsInt64) return value.AsInt64;
        if (long.TryParse(value.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var result)) return result;
        return 0;
    }

    private static double? ReadDouble(BsonDocument document, string key)
    {
        if (!document.ContainsKey(key)) return null;
        var value = document[key];
        if (value == null || value.IsNull) return null;
        if (value.IsInt32) return value.AsInt32;
        if (value.IsInt64) return value.AsInt64;
        if (value.IsDouble) return value.AsDouble;
        return double.TryParse(value.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : null;
    }

    private static LinkRecord[] ReadLinks(BsonDocument document)
    {
        if (!document.ContainsKey("Links") || !document["Links"].IsArray) return Array.Empty<LinkRecord>();
        return document["Links"].AsArray
            .Where(value => value.IsDocument)
            .Select(value => value.AsDocument)
            .Select(link => new LinkRecord
            {
                Name = ReadString(link, "Name") ?? "Link",
                Url = ReadString(link, "Url") ?? ""
            })
            .Where(link => !string.IsNullOrWhiteSpace(link.Url))
            .Take(12)
            .ToArray();
    }

    private sealed class Options
    {
        public string? BackupDirectory { get; init; }
        public string? BackupFile { get; init; }
        public string? LibraryDirectory { get; init; }
        public string? OutputPath { get; init; }
        public string? SpreadsheetBackupDirectory { get; init; }
        public int MinimumAgeSeconds { get; init; } = 300;
        public int MinimumGameCount { get; init; } = 100;
        public int MaximumConcurrentRequests { get; init; } = 8;
        public bool Pretty { get; init; }
        public bool Serve { get; init; }
        public string ListenUrl { get; init; } = "http://+:8092/";

        public static Options Parse(string[] args)
        {
            var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < args.Length; index++)
            {
                var arg = args[index];
                if (!arg.StartsWith("--", StringComparison.Ordinal))
                    throw new ArgumentException("Unexpected argument: " + arg);
                if (arg.Equals("--pretty", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("--serve", StringComparison.OrdinalIgnoreCase))
                {
                    values[arg] = "true";
                    continue;
                }
                if (index + 1 >= args.Length) throw new ArgumentException("Missing value for " + arg);
                values[arg] = args[++index];
            }

            values.TryGetValue("--backup-dir", out var backupDirectory);
            values.TryGetValue("--backup-file", out var backupFile);
            values.TryGetValue("--library-dir", out var libraryDirectory);
            values.TryGetValue("--output", out var outputPath);
            values.TryGetValue("--listen-url", out var listenUrl);
            values.TryGetValue("--spreadsheet-backup-dir", out var spreadsheetBackupDirectory);
            var sourceCount = new[] { backupDirectory, backupFile, libraryDirectory }.Count(value => !string.IsNullOrWhiteSpace(value));
            if (sourceCount != 1)
                throw new ArgumentException("Specify exactly one of --backup-dir, --backup-file, or --library-dir.");
            var maximumConcurrentRequests = ParseInt(values, "--max-concurrent-requests", 8);
            if (maximumConcurrentRequests is < 1 or > 64)
                throw new ArgumentException("--max-concurrent-requests must be between 1 and 64.");

            return new Options
            {
                BackupDirectory = backupDirectory,
                BackupFile = backupFile,
                LibraryDirectory = libraryDirectory,
                OutputPath = outputPath,
                SpreadsheetBackupDirectory = spreadsheetBackupDirectory,
                MinimumAgeSeconds = ParseInt(values, "--min-age-seconds", 300),
                MinimumGameCount = ParseInt(values, "--min-game-count", 100),
                MaximumConcurrentRequests = maximumConcurrentRequests,
                Pretty = values.ContainsKey("--pretty"),
                Serve = values.ContainsKey("--serve"),
                ListenUrl = string.IsNullOrWhiteSpace(listenUrl) ? "http://+:8092/" : listenUrl
            };
        }

        private static int ParseInt(IReadOnlyDictionary<string, string?> values, string key, int fallback)
        {
            if (!values.TryGetValue(key, out var raw)) return fallback;
            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) || parsed < 0)
                throw new ArgumentException($"{key} must be a non-negative integer.");
            return parsed;
        }
    }

    private sealed class LibrarySource : IDisposable
    {
        private readonly bool _ownsWorkingDirectory;
        private readonly string _workingDirectory;
        private readonly FileInfo? _archive;
        private readonly string _fingerprint;

        private LibrarySource(string workingDirectory, bool ownsWorkingDirectory, FileInfo? archive, string fingerprint)
        {
            _workingDirectory = workingDirectory;
            _ownsWorkingDirectory = ownsWorkingDirectory;
            _archive = archive;
            _fingerprint = fingerprint;
        }

        public static LibrarySource Open(Options options)
        {
            if (!string.IsNullOrWhiteSpace(options.LibraryDirectory))
            {
                var directory = Path.GetFullPath(options.LibraryDirectory);
                ValidateRequiredFiles(directory);
                return new LibrarySource(directory, false, null, FingerprintDirectory(directory));
            }

            var archive = SelectArchive(options);
            if (!archive.Exists) throw new FileNotFoundException("Playnite backup was not found.", archive.FullName);
            if (DateTime.UtcNow - archive.LastWriteTimeUtc < TimeSpan.FromSeconds(options.MinimumAgeSeconds))
                throw new InvalidDataException($"The newest Playnite backup is too recent to trust: {archive.Name}. Wait until it is at least {options.MinimumAgeSeconds} seconds old.");
            if (archive.Length < 1024) throw new InvalidDataException("The Playnite backup is implausibly small: " + archive.Name);

            var tempDirectory = Path.Combine(Path.GetTempPath(), "vgcm-playnite-reader-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            try
            {
                using var stream = new FileStream(archive.FullName, System.IO.FileMode.Open, FileAccess.Read, FileShare.Read);
                using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
                var entries = zip.Entries
                    .Where(entry => NormalizeEntryName(entry.FullName).StartsWith("library/", StringComparison.OrdinalIgnoreCase))
                    .Where(entry => RequiredFiles.Contains(Path.GetFileName(NormalizeEntryName(entry.FullName)), StringComparer.OrdinalIgnoreCase))
                    .ToDictionary(entry => Path.GetFileName(NormalizeEntryName(entry.FullName)), StringComparer.OrdinalIgnoreCase);

                var missing = RequiredFiles.Where(name => !entries.ContainsKey(name)).ToArray();
                if (missing.Length > 0)
                    throw new InvalidDataException("The Playnite backup is missing required library files: " + string.Join(", ", missing));

                foreach (var name in RequiredFiles)
                {
                    var targetPath = Path.Combine(tempDirectory, name);
                    using var input = entries[name].Open();
                    using var output = new FileStream(targetPath, System.IO.FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    input.CopyTo(output);
                }
                ValidateRequiredFiles(tempDirectory);

                var archiveAfter = new FileInfo(archive.FullName);
                if (archiveAfter.Length != archive.Length || archiveAfter.LastWriteTimeUtc != archive.LastWriteTimeUtc)
                    throw new InvalidDataException("The Playnite backup changed while it was being read. No output was produced.");

                return new LibrarySource(tempDirectory, true, archive, FingerprintDirectory(tempDirectory));
            }
            catch
            {
                try { Directory.Delete(tempDirectory, true); } catch { }
                throw;
            }
        }

        private static FileInfo SelectArchive(Options options)
        {
            if (!string.IsNullOrWhiteSpace(options.BackupFile)) return new FileInfo(Path.GetFullPath(options.BackupFile));
            var directory = new DirectoryInfo(Path.GetFullPath(options.BackupDirectory!));
            if (!directory.Exists) throw new DirectoryNotFoundException("Playnite backup directory was not found: " + directory.FullName);
            return directory.EnumerateFiles("*.zip", SearchOption.TopDirectoryOnly)
                       .OrderByDescending(file => file.LastWriteTimeUtc)
                       .ThenByDescending(file => file.Name, StringComparer.OrdinalIgnoreCase)
                       .FirstOrDefault()
                   ?? throw new FileNotFoundException("No Playnite backup ZIP was found in " + directory.FullName);
        }

        public string PathFor(string name) => Path.Combine(_workingDirectory, name);

        public SourceDescription Describe() => new()
        {
            FileName = _archive?.Name ?? Path.GetFileName(_workingDirectory),
            FullPath = _archive?.FullName ?? _workingDirectory,
            SizeBytes = _archive?.Length,
            LastWriteUtc = _archive?.LastWriteTimeUtc,
            Fingerprint = _fingerprint,
            LibraryFileCount = RequiredFiles.Length,
            ReadMode = _archive == null ? "existing-library-directory-read-only" : "zip-library-files-only"
        };

        public void Dispose()
        {
            if (!_ownsWorkingDirectory) return;
            try { Directory.Delete(_workingDirectory, true); } catch { }
        }

        private static void ValidateRequiredFiles(string directory)
        {
            var missing = RequiredFiles.Where(name => !File.Exists(Path.Combine(directory, name))).ToArray();
            if (missing.Length > 0)
                throw new InvalidDataException("Required Playnite library files are missing: " + string.Join(", ", missing));
        }

        private static string FingerprintDirectory(string directory)
        {
            using var aggregate = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            foreach (var name in RequiredFiles.OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
            {
                var nameBytes = Encoding.UTF8.GetBytes(name.ToLowerInvariant() + "\n");
                aggregate.AppendData(nameBytes);
                using var file = File.OpenRead(Path.Combine(directory, name));
                var hash = SHA256.HashData(file);
                aggregate.AppendData(hash);
            }
            return Convert.ToHexString(aggregate.GetHashAndReset()).ToLowerInvariant();
        }

        private static string NormalizeEntryName(string value) => value.Replace('\\', '/').TrimStart('/');
    }

    private sealed class Snapshot
    {
        public string SchemaVersion { get; init; } = "";
        public DateTime GeneratedAtUtc { get; init; }
        public SourceDescription Source { get; init; } = new();
        public SnapshotStatistics Statistics { get; init; } = new();
        public List<GameRecord> Records { get; init; } = new();
    }

    private sealed class SourceDescription
    {
        public string FileName { get; init; } = "";
        public string FullPath { get; init; } = "";
        public long? SizeBytes { get; init; }
        public DateTime? LastWriteUtc { get; init; }
        public string Fingerprint { get; init; } = "";
        public int LibraryFileCount { get; init; }
        public string ReadMode { get; init; } = "";
    }

    private sealed class SnapshotStatistics
    {
        public int GameRecords { get; init; }
        public int ApprovedStorefrontRecords { get; init; }
        public int ExactTitleKeys { get; init; }
        public int CandidateFamilyKeys { get; init; }
        public int SourceDefinitions { get; init; }
        public int PlatformDefinitions { get; init; }
        public int MissingSource { get; init; }
        public int MissingPlatform { get; init; }
        public Dictionary<string, int> BySource { get; init; } = new();
    }

    private sealed class GameRecord
    {
        public string RecordKey { get; init; } = "";
        public string PlayniteId { get; init; } = "";
        public string StorefrontGameId { get; init; } = "";
        public string? PluginId { get; init; }
        public string? SourceId { get; init; }
        public string? SourceName { get; init; }
        public string Name { get; init; } = "";
        public string ExactTitleKey { get; init; } = "";
        public string NormalizedTitle { get; init; } = "";
        public string[] Platforms { get; init; } = Array.Empty<string>();
        public string[] Genres { get; init; } = Array.Empty<string>();
        public string[] Series { get; init; } = Array.Empty<string>();
        public string? CompletionStatus { get; init; }
        public string? ReleaseDate { get; init; }
        public int? ReleaseYear { get; init; }
        public DateTime? AddedUtc { get; init; }
        public DateTime? ModifiedUtc { get; init; }
        public DateTime? LastActivityUtc { get; init; }
        public bool Favorite { get; init; }
        public bool Hidden { get; init; }
        public bool Installed { get; init; }
        public long PlaytimeSeconds { get; init; }
        public long PlayCount { get; init; }
        public long InstallSizeBytes { get; init; }
        public double? CriticScore { get; init; }
        public double? CommunityScore { get; init; }
        public LinkRecord[] Links { get; init; } = Array.Empty<LinkRecord>();
    }

    private sealed class LinkRecord
    {
        public string Name { get; init; } = "";
        public string Url { get; init; } = "";
    }
}
