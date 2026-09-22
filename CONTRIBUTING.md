# Contributing

Start with a reproducible configuration failure, not a new dashboard module. A useful contribution improves one evidence chain, one supported runtime boundary, one privacy property or one truthful negative case.

The delivered source has not been built or tested. Establish a real baseline using [VALIDATION.md](docs/VALIDATION.md) before describing any behavior as confirmed.

## Small, coherent changes

For a runtime or adapter change, include a tiny fixture, its expected application-visible behavior, the intended observations and the cases that must remain unknown. Run the fixture with and without tracing when validation is authorized. Avoid replacing an external loader's parser or precedence rules with a second implementation.

Keep the core deterministic and local. No LLM service, hosted account, database or automatic configuration repair is required. Add dependencies only when their value and maintenance cost are clear.

## Contracts to preserve

- Raw environment values must cross the in-memory token boundary before serialization. Never log arbitrary caught exceptions, argv dumps or the full environment.
- Missing, empty, omitted and incomparable are different states.
- Original application operations should be delegated once. Do not swallow their exceptions or perform a second getter evaluation just to observe them.
- Causal references require evidence; timestamps alone do not establish cross-process causality.
- Unsupported coverage, truncated streams and missing children are visible results, not embarrassing details to hide.
- Reports escape every metadata field and have no external asset dependency.
- Existing files are not overwritten silently. Pair keys do not enter exports.

## Where changes belong

`src/core` contains schema/privacy/collection/analysis/export. `src/runtime` owns Node hooks and recording. `src/adapters` contains loader-specific behavior. `src/report` renders already-normalized evidence. The CLI is orchestration, not a second analysis engine.

A third-party adapter implements the synchronous `ConfigTraceAdapter` lifecycle and returns cleanup when it installs a hook. It must be explicitly selected by the user. Adapters are trusted code, not sandboxed plugins. See `examples/custom-adapter.cjs`.

## Validation and pull requests

Batch related edits, then run the smallest relevant checks followed by the focused suite at the checkpoint. Do not add a separate test for every trivial helper merely to inflate coverage. Prioritize semantic preservation, privacy, comparison correctness and honest unknowns.

A change description should state what was executed, exact versions, actual results and what remains unverified. Do not call a plan or fixture inventory a passing test report. Share synthetic artifacts only, after reviewing the export.

Before publication, configure a real private security-reporting channel as described in [SECURITY.md](SECURITY.md).
