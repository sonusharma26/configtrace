# Architecture

Status: implemented source for v0.2.0; compilation, tests, demos and compatibility checks have not been executed. This document describes the intended contracts and the written code, not measured behavior.

## Product boundary

ConfigTrace is a local diagnostic recorder for selected environment keys in a deliberately launched Node application. It is not a secret manager, universal configuration graph, production agent, shell recorder, or authenticated audit system.

The unit of evidence is an observation in one process, linked where possible to an earlier observation of the same key. A report must distinguish an event captured by an adapter from a causal interpretation of that event. Unknown is a valid result.

## Components

```text
CLI / library run()
    | validate command, selection, comparison key and output
    | create private session directory
    v
Node --require <preload> [--enable-source-maps] <application>
    |
    +-- watched process.env Proxy
    +-- contained dotenv adapter
    +-- optional direct-Node child injection
    +-- optional explicitly trusted local adapters
    |
    v
Recorder: primitive values -> keyed tokens -> bounded JSONL stream
    |
    v
Collector: schema validation, sequence links, missing stream detection
    |
    v
Versioned .ct.json + coverage manifest
    +-- explain one key / selected process
    +-- compare a deliberately paired execution
    +-- static local HTML
    +-- export a newly pseudonymized artifact or paired directory
```

One package contains these modules. Creating six independently versioned workspace packages would add publication and dependency coordination before the runtime contracts are validated. The internal boundaries permit a later split without requiring one now.

## Launcher and process lifetime

`src/launcher.ts` accepts a direct Node invocation, not arbitrary shell syntax. It preserves application arguments and working directory, adds the preload before the application arguments, and inherits standard streams. It never records the full command line or full environment in a trace.

A private temporary directory contains a session configuration and one JSONL stream per recorder. The session configuration contains the comparison secret, watched selectors, paths and bounds. It does **not** contain a dump of application environment values. Directory/file creation requests POSIX 0700/0600 permissions; Windows permissions depend on the account and filesystem ACLs.

The root exit outcome and recorder outcome are separate. A failed final artifact write is reported with `artifactWritten: false` without replacing the application's exit code. Signal forwarding is best effort; process groups, unusual inherited stdio handles and detached descendants are not comprehensively managed. Cleanup removes the session directory in a `finally` block on the ordinary completion path. Crashes, forced termination or filesystem failures can leave restricted temporary files.

The optional child drain has a fixed upper bound. A child that survives collection is incomplete evidence, not a reason to block indefinitely or kill the application. This is not a process supervisor.

## Observation model

The source of truth is `src/core/schema.ts`. The version identifier is `configtrace/1`.

| Field / concept | Meaning |
| --- | --- |
| `processId`, `seq` | Process-local identity and monotonically increasing observation order |
| `at` | Process-relative monotonic elapsed time; not a distributed/global clock |
| `operation` | `baseline`, `read`, `write`, `delete`, `candidate`, `skip`, `load`, or `child-spawn` |
| `value` | A present keyed token, a missing state, or an omitted state |
| `site` | Scrubbed file and optional position, with mapping quality |
| `origin` | `startup`, `runtime`, `dotenv`, or `unknown`, with independent confidence |
| `causedBy` | Earlier event in the same process and key, when a link is supported |
| `purpose` | Application observation or loader observation |
| `outcome` | Limited machine-readable outcome, not an arbitrary exception message |

A missing key is not an empty string. An omitted token is not a missing key. Two unrelated comparison domains do not establish value equality or inequality for present values.

Schema validation rejects unknown fields, duplicate event/process identifiers, invalid positions, out-of-order per-process events, references to unknown processes and invalid backward causal links. Schema validity is not authenticity: a sender can fabricate a syntactically valid trace.

## Environment instrumentation

`src/runtime/environment.ts` retains the original environment object and exposes a Proxy through `process.env`. Get, set, delete and define-property traps delegate to the original object. Values are observed after the actual operation where appropriate. The recorder does not introduce its own string coercion rules.

Exact selectors receive startup observations even when missing. Pattern selectors discover matching present keys and later matching operations; they cannot enumerate every possible absent key. Internal `__CONFIGTRACE_*` keys are excluded. Key selection is canonicalized for the main Windows environment model.

Replacing the object with a Proxy changes identity. Original references, native code, property descriptors, some enumeration patterns, Workers, and subsequent replacement of `process.env` can bypass value observation. Capturing every read is not promised. Stack collection, synchronous writes and wrappers can change timing even when return values appear unchanged.

Recorder operations run under a recursion guard when they would otherwise trigger their own hooks. Recursion suppression is not a sandbox and does not make arbitrary adapters safe.

## dotenv adapter

`src/adapters/dotenv.ts` observes the installed library rather than copying its parsing or population algorithm. Its intended shape is the CommonJS 16.x/17.x API; the bundled test dependency is pinned to 17.2.3. No version has been executed against this delivery.

A contained `Module._load` hook identifies candidate dotenv exports. The cwd-resolved main export is loaded and patched early so common ESM namespace creation can see the wrappers. ConfigTrace never calls `config()` merely to install the adapter. Nevertheless, early module evaluation can alter order and side effects; `--no-dotenv` disables this behavior.

Within synchronous `config` / `configDotenv` frames, the adapter observes `readFileSync`, `parse`, and `populate`. A parsed object is associated with a file only when the parsed input is the exact result of an observed read. Per-key origin metadata is stored in a WeakMap; a persistent raw-value cache is not maintained.

Population into real `process.env` can produce candidate observations, delegated Proxy writes and a not-applied observation. A skip means that the supported call left an existing value unchanged without a captured assignment. It does not claim interception of an internal `if (override)` branch. Intermediate multi-file merges use net changes to infer file attribution; equal-valued ambiguous candidates remain unknown. A custom `processEnv` target is not misrepresented as the real environment.

Getters, unusual objects, unknown versions, encrypted/bundled loaders or bypassed exports can limit attribution. Original loader failures are rethrown to the application, but their arbitrary message text is not written to the evidence stream.

## Attribution and source maps

Call sites come from structured V8 stack entries and are scrubbed before persistence. ConfigTrace temporarily changes `Error.prepareStackTrace` and restores it and the stack limit in a `finally` block. Tool and Node-internal frames are filtered.

`--source-maps` enables Node's source-map cache. Mapping uses `findSourceMap()` and zero-based `findEntry()` coordinates. A failed lookup retains the generated position rather than inventing an original TypeScript line. Missing maps, remapped filenames and custom transpiler runtimes are explicitly unverified. Source file contents and `sourcesContent` are not copied into traces.

## Bounded children

`src/runtime/children.ts` contains the private normalized `ChildProcess.prototype.spawn` boundary. It checks the runtime shape and only modifies supported asynchronous direct Node launches when opted in. Arguments and environment pairs are cloned; the original operation is called once.

Injected children receive the same session and comparison domain plus a parent identity. A preload guard avoids double initialization when fork also inherits a preload. Limits are four descendant levels and sixteen injected children per process. The collector additionally caps the number of process streams. Shells, sync APIs, detached processes, Workers, native launchers and arbitrary executable aliases are not supported.

A parent `child-spawn` event alone is not proof of a child's recorded history. A matching stream supplies that history. Process-relative clocks are never presented as a universally ordered cross-process causal timeline. Diff defaults to each trace's root; child comparison requires explicit left/right process selection.

## Persistence and collection

The recorder performs keyed transformation before serialization. It stores fixed-code notices rather than raw exceptions. Events are bounded by count, byte count and distinct-key count; repeated application reads are not silently deduplicated because their order matters. The footer records dropped events and termination where available.

The collector uses bounded reads and strict record schemas. It recovers valid prefixes from interrupted streams, marks malformed/truncated data, and never turns a missing footer into successful completion. An invalid cause reference is downgraded rather than treated as established provenance.

Default bounds in the implementation:

| Bound | Value |
| --- | --- |
| Selectors | 1–64 |
| Distinct watched keys | 256 per recorder |
| Events | 5,000 per process; configurable 10–100,000 |
| Stream bytes | 8 MiB per process, with footer reserve |
| Collected raw bytes | 32 MiB |
| Collected streams | 64 |
| Aggregate events | 100,000 |
| Artifact read/write ceiling | 64 MiB |
| Explicit local adapters | 8 |

Limit notices are part of the evidence. An artifact can be syntactically complete while coverage remains limited to observed JavaScript operations.

## Comparison

An explicit private key deliberately pairs runs. Without it, a fresh ephemeral domain is used and present-value tokens from another run are incomparable. Matching a key file to a prior artifact checks its declared domain; key files and unsigned artifacts are trusted diagnostic inputs, not an authenticated protocol.

Diff compares startup state, application-read sequences, read sites, origins, supported loader outcomes and capture coverage. It does not only compare the final value. Timestamps are excluded from equality judgments, and different process IDs are not automatically matched as the same workload.

## Reports and export

HTML is generated locally using escaped metadata, a fixed inline filtering script, and a restrictive hash-based Content Security Policy. There are no CDN dependencies, external fonts, upload endpoints or analytics. Value tokens are replaced with local labels. The single-trace display is capped; a visible warning explains that filtering applies to displayed events only. Source artifacts remain the fuller evidence representation.

Exports construct new schema-valid artifacts. Each export operation generates a fresh token transformation and comparison domain. A jointly exported pair preserves equality within that pair; independent exports break correlation. Minimal metadata strips timestamps/PIDs, scrubs paths and pseudonymizes key names. Policies can retain more metadata, so review is still necessary.

See [PRIVACY.md](PRIVACY.md) for residual risks and [VALIDATION.md](VALIDATION.md) for the unexecuted acceptance plan.
