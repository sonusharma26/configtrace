# Privacy model and residual risks

Status: source design and implementation, not a completed security audit. No leak tests, dependency audits or runtime validation were performed in this delivery.

## What is being protected

The recorder is designed not to persist raw watched environment values in trace events, notices, JSON artifacts or HTML. It transforms primitive values in memory before serialization. The application, its modules and its own logs are outside this boundary.

The comparison secret is different from an environment value: it must exist in a private key file for reusable comparisons and in the restricted temporary session file so participating processes can share a domain. Do not distribute either file.

## Value equality without value disclosure

Present values are represented by HMAC-SHA256 tokens using a random secret. The token input includes a domain separator plus a length-framed canonical key and the value. This is not a plain hash of a low-entropy secret. A missing key has its own state; an empty string is a present value.

Tokens intentionally disclose equality and changes within a comparison domain. Key names, operation frequency, call sites and timings can also disclose business information. Masked values do not make an artifact anonymous.

Key management rules:

1. Create a new pair key for a specific diagnostic comparison, not one organization-wide everlasting key.
2. Keep it outside version control and sharing folders. The supplied `.gitignore` is a convenience, not an access-control boundary.
3. Use the same unchanged key file for the intended runs. A trace does not contain the key and cannot reconstruct it.
4. Export related runs together when cross-run comparisons are needed. Do not send the original pair key.
5. Delete private keys and local evidence when no longer needed. Ordinary unlinking is not guaranteed secure erasure on modern filesystems/backups.

The domain identifier is a correlation namespace, not an authentication signature. Artifacts and key files must not be hand-edited to imply equivalence. Token comparison assumes the inputs were produced honestly with the corresponding key.

## Local storage

New files use exclusive creation to avoid overwriting existing artifacts. Key/session/output files request 0600 mode; private session directories request 0700 on POSIX. Windows requires appropriate user-profile/temp ACLs; POSIX mode bits are not an equivalent Windows guarantee.

Input reads are size bounded and reject nonregular files where checked. `O_NOFOLLOW` is used where available. Parent-directory races, compromised accounts, hostile local filesystems and administrators are not fully defended against. Use directories owned by the diagnostic user.

Raw comparison secrets may remain in restricted temp files after a forced kill or filesystem cleanup failure. Values and secrets still exist in the application's memory and can appear in debugger sessions, core dumps, snapshots, backups or swap. No secure-memory wiping is implemented.

## Export boundary

Default export pseudonymizes all observed key names, uses basename paths, removes PIDs/absolute timestamps and creates fresh per-export tokens. A stricter policy can omit paths and call sites. A custom policy can retain more information.

Joint export preserves pair equality; separate export calls intentionally create different domains. The export manifest states that manual review is required. There is no exhaustive natural-language/entity/secret detector.

Review at least the key labels, filenames, entry paths, source positions, process shape, relative timing and notices. A deliberately crafted filename may itself contain sensitive data. Export does not claim to remove every such secret.

## Report and artifact handling

Received JSON must pass strict schemas and bounds. Reports escape metadata and use a fixed script/style with a hash-based CSP, no network connections and no CDN assets. Raw value tokens are replaced with local display labels in HTML.

No external fonts, telemetry or uploads are part of the shipped runtime. Dependency installation, the launched application, adapters and user-run CI can still access the network. A restrictive report CSP does not make arbitrary locally stored files safe in every browser context. Reports have not undergone browser/security testing in this delivery.

An artifact is not signed. It can omit evidence or lie while remaining schema-valid. Use it for debugging, not as a tamper-proof compliance audit record.

## Out of scope

| Threat / channel | Boundary |
| --- | --- |
| Application stdout/stderr | Inherited unchanged; not captured or sanitized |
| dotenv debug output | Controlled by the application/library; not intercepted as a secret-sanitization channel |
| Native environment reads | Not universally observable through the Proxy |
| Hostile application/adapter | Runs with user privileges; can access env/session secret and bypass hooks |
| Command-line secrets | Command line is not copied into trace metadata, but the OS/shell/application may expose it |
| Local administrator / debugger | Can read process memory and private files |
| Arbitrary copied logs or screenshots | Not included in the exporter |
| Raw artifacts shared without review | Names, paths, equality and process metadata may be sensitive |

See [SECURITY.md](../SECURITY.md) for reporting and [VALIDATION.md](VALIDATION.md) for pending canary tests.
