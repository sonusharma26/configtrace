# ConfigTrace implementation plan

Status: source implementation, not a verified release. This delivery does not run dependency installation, TypeScript compilation, application fixtures, builds, or tests.

## Product boundary

A local Node diagnostic CLI that records selected environment operations, attaches supported loader evidence, compares deliberately paired executions, and exports reviewable diagnostic artifacts. It is not a secret manager, shell-history recovery tool, native tracer, or production monitoring service.

Ship one version 0.2.0 source tree. v0.2 includes every v0.1 milestone; do not maintain two divergent implementations.

## Design decisions

- TypeScript; one npm package with internal core/runtime/adapter/report boundaries instead of six separately released workspaces.
- CommonJS preload so both CJS and ESM applications can use Node's `--require` startup boundary.
- A watched-key Proxy delegates operations to Node's original environment object. Instrumentation is explicitly best effort, not semantically invisible.
- dotenv remains responsible for parsing and assignment. Observe its calls rather than implementing a competing dotenv parser.
- Keyed value fingerprints are applied before the recorder's serialization boundary, starting in v0.1.
- Per-process bounded synchronous JSONL spools; a launcher combines them into a strict versioned JSON bundle. Missing footers mean partial capture, not success.
- No secrets in CLI arguments. Pairing keys live in private local files; artifacts contain only a domain identifier.
- No accounts, database, telemetry, hosted service, AI calls, or automatic application fixes.
- Custom adapters execute trusted local code only. Report input never loads adapters.

## v0.1: establish the evidence path

| ID | Implement | Files/boundary | Acceptance criterion for later execution |
|---|---|---|---|
| A1 | Versioned event, process, coverage and artifact contracts | `src/core/schema.ts` | Unsupported fields/versions rejected; missing is not an empty string |
| A2 | Watch selection, canonical keys, privacy tokens, private files | `src/core/privacy.ts`, `io.ts` | Wildcards bounded; Windows matching explicit; raw value canaries absent from recorder output |
| A3 | Node launcher and bounded capture | `src/launcher.ts`, `src/runtime/preload.ts` | stdout/stderr remain application streams; application exit outcome retained |
| A4 | Baseline/read/write/delete/defineProperty observation | `src/runtime/recorder.ts`, `environment.ts` | Delegates original operations and returns original values/errors |
| A5 | dotenv observation | `src/adapters/dotenv.ts` | Single-file skip/application observed; unsupported loaders never reported as covered |
| A6 | Explanation and same-domain diff | `src/core/analyze.ts` | Explain stale inheritance; refuse cross-domain value equality |
| A7 | Small fixture corpus and regression test sources | `fixtures/`, `tests/` | Stale inheritance, mutation, missing/empty and bypass cases are represented |

## v0.2: make evidence usable outside the first demo

| ID | Implement | Files/boundary | Acceptance criterion for later execution |
|---|---|---|---|
| B1 | Source-map-aware call sites and source fallback | `src/runtime/callsite.ts` | Compiled fixture can map to TypeScript; absent mappings remain explicit |
| B2 | Rich per-key, read-sequence and origin differences | `src/core/analyze.ts` | A change-and-change-back is not hidden by a last-value-only diff |
| B3 | Pair key lifecycle and identity isolation | `src/core/privacy.ts` | Explicit key file pairs runs; missing/mismatched key does not silently compare |
| B4 | Offline HTML evidence report and diff | `src/report/html.ts` | No network resources; escaped data, CSP and visible display limits |
| B5 | Strict single/pair export policy and re-tokenization | `src/core/export.ts` | Key/path masking consistent across pair; fresh exports unlinkable by token |
| B6 | Coverage manifest, doctor command and partial-record recovery | `src/core/collect.ts`, `src/cli.ts` | Missing process footer, event cap and invalid stream are visible |
| B7 | Opt-in bounded asynchronous Node child processes | `src/runtime/children.ts` | Direct Node spawn/execFile/fork instrumented where supported; shell/sync/worker boundaries excluded |
| B8 | Public library and trusted local adapter contract | `src/index.ts`, `src/runtime/api.ts` | CLI and SDK use same analysis; adapter exceptions do not become secret-bearing logs |
| B9 | README, security model, compatibility corpus, release checklist | `README.md`, `docs/` | No tested/overhead/production-ready claim without execution evidence |

## Implementation order and dependency graph

A1 → A2 → A3/A4 → A5 → A6 → B1/B2 → B3/B4/B5 → B6/B7/B8 → A7/B9.

Work can be split between a capture implementer, an analysis/export implementer, a report/docs implementer, and a verifier after the contracts are fixed. No connected sub-agent execution facility was available for this delivery; these are work boundaries, not a claim that agents ran.

## Essential verification sources (written, not run here)

Keep a focused suite rather than a broad test framework: schema/privacy and re-tokenization; native operation delegation; stale dotenv skip; mutation/delete/missing; cross-domain comparison refusal; sequence divergence; partial JSONL recovery; HTML escaping; child boundaries; output/exit preservation.

Run checks in bulk later, not after every source edit. See `docs/VALIDATION.md` for exact commands and remaining compatibility gates.

## Intentional limitations

The startup baseline means "present at preload", not "proven to originate in the shell". Earlier Node flags, preloads, `--env-file`, or native startup may have supplied it. A matching last observed write is an inferred link, not proof that unobserved mutations never occurred. An absence of captured reads is not proof a key was unused. Child processes are compared explicitly, never aligned by unrelated OS PIDs. A complete stream is not universal environment coverage.
