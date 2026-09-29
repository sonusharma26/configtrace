# Architecture — v0.3

## Runtime path

```text
CLI direct Node launch
  -> private temporary session + preload
  -> selected process.env Proxy
  -> dotenv / native env / trusted adapter observations
  -> optional child and Worker preload propagation
  -> in-memory keyed fingerprint boundary
  -> bounded per-context JSONL streams + declarations/notices
  -> collector validates contexts/order and records missing streams
  -> configtrace/2 artifact
```

The launcher does not replace arbitrary shells. It passes through application output, exit codes, and signals where supported. The temporary session contains the comparison secret; it is restricted local state, not an exported artifact. Same-privilege application code is outside the isolation guarantee.

## Analysis path

```text
readTrace / strict schema
  -> context selection and captured key evidence
  -> provenance DAG
  -> paired diff / deterministic diagnosis / contracts / ordered drift
  -> terminal, JSON, offline HTML
  -> token-free authorized MCP projection
```

The provenance engine distinguishes observed operations from derived/inferred relationships. Context-local order and confirmed parent-child creation are the only ordering links used; it does not merge process or Worker timestamps into a global causal sequence. Source files are origins; read-site nodes are sinks; these identities are intentionally distinct.

Diagnosis uses common call-site occurrence comparisons and bounded relevance intervals. A marker is explicit metadata without exception arguments. A nonzero exit does not create an invented first-failure boundary. Contracts evaluate captured evidence, with a separate inconclusive result. History compares adjacent entries in a chosen order, not unobserved deployment state.

## Worker boundary

The Worker constructor wrapper preserves `env` and `workerData`, injects preload arguments, and supplies context metadata through cloned environment data. Session-wide exclusive slot files bound instrumented creations; each Worker writes its own stream. Known children without streams are unconfirmed. Shared environments do not imply observed cross-thread writers.

## Persistence and formats

Core schemas and runtime capture remain in one npm package. Capture output uses configtrace/2; the reader retains configtrace/1 compatibility. Derived payloads have independent schema labels. Older binaries need not read new captures. Custom adapters must use the recorder for value-bearing observations and must not persist raw values independently.

Artifact parse/byte/event limits protect normal read paths; they are not an application sandbox or a complete denial-of-service guarantee. Most typed library APIs assume parsed Trace objects. Disk inputs must pass through readTrace. Evidence files are unsigned and unauthenticated.

## Module ownership

- `core/`: schema, privacy, I/O, collection, original explanations/diffs, export.
- `runtime/`: instrumentation, session/bootstrap, context capture, recorder lifecycle.
- `adapters/`: dotenv, native env, declared adapter catalog.
- `analysis/`: graph, diagnosis, contracts, history; no application execution.
- `agent/`: tools-only MCP snapshots and token-free projections.
- `report/`: offline HTML and local filtering.
- `cli.ts`: validated command dispatch; execution is confined to explicit run/demo commands.

See the README and requested-features document for scoped or unfinished behavior. No architecture claim is a test result.
