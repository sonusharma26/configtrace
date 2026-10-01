# Privacy boundary and disclosure model

Raw environment values are fingerprinted in the recorder before its event stream is serialized. HMAC inputs include the selected key identity. Explicitly paired runs share a private domain key; unrelated domains are not treated as comparable. New value metadata distinguishes empty from missing. This is intentional information disclosure, not a plaintext-value feature.

Temporary native-loader candidate maps and before/after snapshots hold raw strings briefly in memory. The extra bounded candidate read uses Node's parser. Maps are cleared after the call, but JavaScript strings are not securely erased and the process is not a secret-isolated sandbox. The temporary session configuration holds the comparison key, as required for descendant recorders.

Original artifacts retain fingerprints plus metadata such as key names, scrubbed paths, identities, timing, and sources. Local HTML replaces fingerprints with masked equality classes. DAG/diagnosis/verification/history payloads expose states and evidence rather than plaintext. MCP event projection also withholds fingerprints, comparison-domain identifiers, and secret keys. It authorizes snapshots explicitly and does not expose run/file-discovery/shell functions.

Export generates a fresh keyed transformation and optional key aliases, preserving intended paired relationships. Minimal metadata drops OS PIDs, parent OS PIDs, thread IDs, timestamps, and adapter declarations. Exported context relationships remain pseudonymous. Disabling comparisons removes present-value equality information; missing state can remain visible. Removing loaders/call sites reduces what later policy or analysis can conclude.

Sanitization does not certify that all arbitrary metadata is harmless. Paths, key names, source labels, application-chosen strings, event timing, relationships, and manifest text may identify users, infrastructure, or secrets. Review the actual exported files before sharing or authorizing an agent. A malicious producer can put sensitive content in metadata fields; the schema is not a secret detector.

Application stdout/stderr are inherited, not captured or sanitized. Uncaught exceptions may still be printed by Node/application handlers. ConfigProof's marker does not persist exception messages, but does not suppress the application's output. Never treat terminal transcripts as equivalent to sanitized artifacts.

Windows permissions and race behavior require testing. Regular-file and size checks reject direct symlink inputs where implemented, but do not establish a sandbox against same-user races, malicious ancestors, or a cooperating application. Same-privilege code can inspect or tamper with recorder/session state. Artifacts are unsigned and not tamper-evident.

Synthetic checks exercise HMAC framing, query stripping and token-free HTML projection. They are not a penetration test or permission to use production credentials. Follow VALIDATION.md and use synthetic values for release checks.

## Optimization cache boundary

The recorder retains decoded comparison-key bytes for its own lifetime but does not memoize raw environment values. This changes setup allocation, not the existing local-secret/same-privilege threat model. Path caches discard query/fragment text before retaining keys and have 512-entry budgets; successful source-map locations also have 512-entry budgets per scrubber and return copies. Metadata paths are still potentially sensitive. Caches are not a secure-erasure mechanism.

Analysis indexes hold references to already-recorded masked evidence. A 4,096-string intern pool and a 32,768-reference/64-summary budget bound additional retained label caches; the underlying trace and index scale with event count. Only authorizer-owned frozen MCP snapshots retain automatic indexes. Compact report payloads are explicit display projections without raw HMAC tokens, not full traces hidden in HTML. Script-like metadata is escaped at serialization and inserted as DOM text; arbitrary metadata still needs human review.
