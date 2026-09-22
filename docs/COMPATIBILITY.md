# Compatibility and coverage

**All rows below are unverified by execution in this delivery.** A code path being implemented does not mean the corresponding Node, OS, loader or framework combination has passed. No builds or tests were run.

## Intended target matrix

| Area | Written support path | Current qualification |
| --- | --- | --- |
| Node 22.14+ within 22.x | CommonJS preload, selected env Proxy, CLI/library | Target only; unverified |
| Node 24.x | Same | Target only; unverified |
| Other Node majors | Outside `engines` declaration | Not supported in this source scope |
| Linux / macOS | Main process plus opt-in direct Node children; POSIX file modes | Target only; signal/filesystem behavior unverified |
| Windows | Main process with case-insensitive key selection; direct Node children | Target only; ACLs, quoting, key casing and signal fallback unverified |
| CommonJS app | Preload before application module | Implemented, unverified |
| ESM app | CJS preload; eager cwd-resolved dotenv patch | Implemented, unverified; not a general ESM loader hook |
| Compiled TypeScript | Existing source maps via Node cache, opt-in | Implemented, unverified; generated position retained on miss |
| dotenv 16.x / 17.x | CommonJS main export shape and delegated operations | Shape-targeted only; fixture version 17.2.3 has not been run |
| Multiple dotenv files | Candidate/write/skip evidence and inferred intermediate origins | Equal-value ambiguity remains unknown |
| Custom dotenv `processEnv` | Coverage notice; no false claim of real env assignment | Custom-object read provenance is outside scope |
| Async `spawn` / `execFile` / `fork` | Opt-in normalized direct-Node spawn hook | Private API; runtime checks and pending fixtures |
| Third-party adapter | Explicit trusted CJS module and cleanup | Executes with full application privileges |
| Offline HTML | Static report with local filtering | Source written; browser rendering not exercised |

The manually triggered CI matrix covers Node 22/24 on Ubuntu, Windows and macOS when a maintainer elects to run it. Its existence is not a pass result. Hosted runner versions and dependency resolutions must be recorded when publishing actual results.

## Known boundaries

| Case | Honest result / limitation |
| --- | --- |
| Parent shell history | Startup presence can be observed; which profile/export command supplied it is unknown |
| `NODE_OPTIONS` earlier preload | Earlier code can read/mutate/capture the original env object before ConfigTrace starts |
| `node --env-file=...` | Values may already exist when the preload starts; no file-to-value native loader adapter |
| Native addons / Node internals | JS Proxy is bypassable; no completeness claim |
| Previously captured original `process.env` | Access bypasses the current Proxy; later provenance can be unknown |
| `Object.getOwnPropertyDescriptor(process.env, key)` | Descriptor access is not treated as a captured get/read |
| Full env enumeration | Some value access may be observed; pure key enumeration is not a complete-read claim |
| Replacement of `process.env` | Hooks can be bypassed; restoration/coverage is conservative |
| Application exit callbacks registered later | Reads after ConfigTrace finalization are outside the captured interval |
| Worker threads | No worker recorder is installed; worker-copy/shared-env semantics are not attributed |
| Shell / `exec('node ...')` | No injection through shell commands |
| `spawnSync`, `execSync`, `execFileSync` | No child injection |
| Detached children | No injection |
| Native/custom executable aliases | Not generally recognized as Node |
| Child survives collection | Partial stream / missing footer, not fabricated completion |
| Instrumentation loaded twice | Guard prevents intended duplicate setup; unusual preload combinations unverified |
| Framework bundled dotenv | Original package/export interception can be bypassed |
| Non-cwd ESM dotenv resolution | May form a namespace before the expected patched export is available |
| dotenvx / encrypted formats / alternative loaders | Not promised; ordinary env reads may still be observed |
| `tsx`, ts-node, custom ESM loaders | Not included in the compatibility promise |
| Vite/Webpack/browser `import.meta.env` substitution | Build-time adapter would be required; no runtime provenance claim |
| Malicious application or adapter | Can tamper with recorder data or leak secrets; not a sandbox |

## Interpretation rules

`capture.status: complete` means the collector found a completed captured stream set within its known bounds. It does not mean native access, earlier history, unobserved descendants or all possible reads were covered.

An `active` coverage feature means the adapter was attached, not that its implementation is proven correct on every target. `observed` is local event evidence, `inferred` is a documented interpretation, and `unknown` means required evidence is unavailable.

No wall-clock performance targets, zero-overhead claims or transparency guarantees have been validated. Compare the same fixture with instrumentation on and off before relying on it.

## Updating this matrix

Record the exact ConfigTrace commit/archive, Node version, OS, dotenv version, application/module mode and commands. Attach actual outputs with synthetic values. Change a row to validated only for the combinations run, include failures, and preserve unsupported cases. See [VALIDATION.md](VALIDATION.md).
