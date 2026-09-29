# Compatibility targets — NOT validated

Every entry below is a source-level target. No platform, runtime, library, browser, or MCP client was exercised during this update. Existing v0.2 claims were not upgraded into test results.

| Area | Target | Status / limitation |
|---|---|---|
| Node | 22.14+ within 22.x, 24.x | Unrun; engines enforced by manifest only where the package manager honors them. |
| OS | Windows, Linux, macOS | Unrun; Windows Worker/main case behavior and filesystem permissions need special verification. |
| Application modules | Direct Node CJS and ESM | Unrun; early preloads/retained references/native access may bypass hooks. |
| TypeScript | Compiled JS with optional source maps | Unrun; no universal ts-node/tsx/framework loader claim. |
| dotenv | 16.x / 17.x targets; development dependency 17.2.3 | Unrun; eager load/private CJS interception may alter behavior. |
| Native env | process.loadEnvFile + util.parseEnv where available | Unrun; bounded extra file read yields inferred candidates. |
| Startup env files | --env-file, --env-file-if-exists declarations | Conservative hints only; parsing occurs before preload. |
| Workers | Plain-data options; copied/explicit/SHARE_ENV; direct constructor hook | Unrun, opt-in; no promise for early constructors, internal threads, custom loaders or accessor options. |
| Children | Async direct Node spawn/execFile/fork paths within bounds | Unrun; no sync/shell/detached/general process tracing. |
| HTML | Browser supporting inline SHA-256 CSP and local JS/DOM | Unrun; no browser or accessibility audit. |
| MCP | Tools-only stdio; 2025-11-25 / 2025-06-18 negotiation | Unrun; no HTTP transport and no verified named-client configuration. |
| Legacy artifact | configtrace/1, toolVersion 0.2.0 | Reader code accepts it; backward-read tests are unrun. |
| Current artifact | configtrace/2, toolVersion 0.3.1 | Current capture target. |
| node-config / convict / NestJS | No implementation | Planned catalog entries only. |

Native-addon access, original process.env references, pre-instrumentation history, replaced environment objects, early/nested lifecycle paths, build-time/browser substitution, and late exit-handler operations are not fully observed.

Record actual runtime, OS, dependency version, command, output, fixture expectation, result, and failure evidence before changing an entry to validated. Do not infer broad support from a single passing demo.
