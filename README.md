# ConfigTrace

**See which environment values your Node application actually reads—and what differs between two executions.**

ConfigTrace records selected runtime environment operations, adds evidence from supported dotenv calls, and produces local explanations, paired-run comparisons, and reviewable issue artifacts. It does not ask you to print your database password to debug a configuration problem.

**Delivery status:** v0.2.0 source implementation, including the v0.1 scope. On Windows with Node 24.19.0, dependency installation, audit, registry-signature verification, type checking, build, the 15-test focused suite, the synthetic CLI workflow, and source-map attribution have passed. Node 22, cross-platform, browser, performance, and broader compatibility validation remain pending. This is not a production-certified release.

## Start here

Use a Node 22 runtime at or above 22.14, or Node 24. Node 24.19.0 is the currently validated local target; the broader compatibility matrix remains pending.

From the extracted project directory:

```sh
npm install --ignore-scripts
npm run build
node dist/cli.js demo stale-env
```

Those are commands for your local machine; they were not executed when this source archive was prepared. No install/prepare/prepublish hooks secretly invoke a build. `npm test` is also separate from `npm run build`.

The demo creates a new directory under `.configtrace/` containing a synthetic failing run, a corrected run, a private pair key, and `comparison.html`. Open the HTML file locally. All values in the bundled demo are fake. **Do not share the whole demo directory: it includes its comparison key.**

The application in the failing run already has a database URL at preload time. Its dotenv call does not replace that value. The corrected run starts without it, allowing the file's value to be assigned. Both executions use the same comparison key.

Illustrative explanation—not output captured during this delivery:

```text
DATABASE_URL
============
At preload: present · masked
Last read: src/database.js:18
Evidence-linked source: startup / inferred

dotenv: a candidate was not applied to the watched environment.
Earlier history: unknown. Presence at preload does not prove a shell origin.
```

The npm name `configtrace` is a working name, not a registry-availability claim. This checkout has `"private": true` to prevent accidental publication. To use the short command locally after building:

```sh
npm link --ignore-scripts
configtrace --help
```

## What is implemented

| v0.1: runtime evidence | v0.2: usable diagnostic artifacts |
| --- | --- |
| Direct Node launch wrapper | Multiple watched keys and `*` / `?` patterns |
| Startup baseline; selected reads, writes, deletes and property definitions | Opt-in source-map-aware call sites |
| dotenv candidate/application/non-application evidence | Whole observed read-sequence comparison, including intermediate divergence |
| Versioned JSON artifact and human-readable explanation | Static, offline HTML trace and comparison reports |
| In-memory value masking and deliberately paired comparisons | Single and paired exports with fresh tokens and key/path policies |
| Bounded capture; original application exit outcome | Explicit coverage manifest, partial-stream recovery and `doctor` |
| Small synthetic failure fixtures | Bounded opt-in direct Node children; library and local adapter APIs |

One source tree implements both milestones. See [the implementation plan](IMPLEMENTATION_PLAN.md) for task boundaries and acceptance criteria.

## Trace your application

Create a comparison key once for the pair you intend to compare:

```sh
configtrace keygen --out .configtrace/pair.key.json

configtrace run \
  --watch DATABASE_URL,API_URL \
  --key .configtrace/pair.key.json \
  --out bad.ct.json \
  -- node server.mjs
```

After correcting the suspected environment or loader problem, launch the same application again:

```sh
configtrace run \
  --watch DATABASE_URL,API_URL \
  --key .configtrace/pair.key.json \
  --compare-with bad.ct.json \
  --out good.ct.json \
  -- node server.mjs

configtrace explain DATABASE_URL --from bad.ct.json
configtrace diff bad.ct.json good.ct.json
configtrace diff bad.ct.json good.ct.json --format html --out comparison.html
```

The commands above use POSIX line continuations. Put each command on one line in PowerShell or other shells with different continuation syntax. The bundled demo handles synthetic environment setup portably.

`--compare-with` checks that the key file belongs to the earlier raw trace's domain. It does not infer, extract, or recover the secret from an artifact. You can omit this flag when using the same `--key` deliberately.

Without `--key`, each run gets an ephemeral comparison domain. Such a run is still useful for an individual explanation. Two unrelated runs cannot establish equality of present masked values; the diff reports **incomparable**, rather than pretending different HMACs prove different original values. Presence versus absence can still be compared.

### Working directory and watched patterns

```sh
configtrace run --cwd ./my-app --watch 'DB_*' --watch PORT --out run.ct.json -- node dist/server.js
```

Quote patterns so the shell does not expand them. Only selected keys are recorded; **all accesses through the replacement environment object still pass through the Proxy**. Unselected accesses do not capture stacks or values.

`--cwd` controls the application working directory and project-relative metadata. ConfigTrace output paths, key files, comparison files, and adapter paths are resolved from the invoking terminal's directory, not from `--cwd`.

The root command must be `node`, `node.exe`, or the exact Node executable running the CLI. Shell syntax, `npm run`, `pnpm`, Bun, and arbitrary command runners are not root-launch features. Pass the application's actual Node entry point instead. Application arguments after `--` are forwarded, not saved in the trace.

### TypeScript call sites

Use your application's normal compiled JavaScript with source maps:

```sh
configtrace run --watch DATABASE_URL --source-maps --out typescript.ct.json -- node dist/server.js
```

This enables Node's source-map cache and asks the call-site collector to map generated positions to original sources. Missing maps, unsupported mappings, and custom loader behavior remain fallback cases. An available generated location is kept instead of inventing a TypeScript line number. This is not a TypeScript compiler or a promise of support for every transpiler.

## Read an explanation or report

```sh
configtrace explain DATABASE_URL --from run.ct.json
configtrace explain DATABASE_URL --from run.ct.json --format json --out explanation.json
configtrace report run.ct.json --out report.html
configtrace doctor --from run.ct.json
```

The HTML report is a standalone file. It uses system fonts, escaped metadata, a restrictive Content Security Policy, and no external resources or network calls. Search the rendered timeline by key, origin, file, or process; filter by operation. Values appear as local labels such as `V01`, not as raw strings or HMACs.

A single-run report displays at most 2,000 events. A comparison report displays at most 100 key detail sections and 40 events per side in each section. Display limits are disclosed; the JSON retains its captured evidence. Filtering searches the rendered events, not hidden uncopied JSON.

### How to interpret confidence

**Observed** describes something a hook actually captured: a read result, successful assignment, deletion, file read, or startup presence.

**Inferred** describes a relationship supported by observations. For example, a read value matches the last captured write, or a parsed candidate can be associated with an intermediate dotenv merge. Matching values do not prove that no unobserved mutation happened between them.

**Unknown** means the necessary history or attribution is unavailable. This is a valid diagnostic result, not an error to be papered over.

The startup baseline means **“present at the ConfigTrace preload”**, not **“definitely inherited from the shell.”** A prior `NODE_OPTIONS` preload, `--env-file`, native startup behavior, or another earlier action could have supplied it.

`skip` means a candidate was not applied by a supported `populate` call: it was present before the call, no captured assignment occurred, and its observed value remained unchanged. ConfigTrace does not claim to intercept dotenv's internal branch decision or provide an exact file line for every `.env` assignment. Equal-valued candidates in intermediate file merges can have ambiguous origins.

## Compare two runs

The diff considers startup state, the last observed application read, the complete captured read sequence, read sites, inferred origins, loader outcomes, and changes in coverage declarations. It does not hide an intermediate difference just because both executions end with the same value.

Sequences are compared by observed order and call site. This is not a causal alignment of concurrent requests, and a missing read is not proof a variable was unused.

By default, only the two root processes are compared. To select recorded child processes:

```sh
configtrace diff bad.ct.json good.ct.json --left-process p_LEFT_ID --right-process p_RIGHT_ID
configtrace explain DATABASE_URL --from bad.ct.json --process p_LEFT_ID
```

Use identifiers from the artifacts or HTML report; replace the example identifiers above. Child processes are never matched merely because their unrelated OS PIDs or spawn order happen to coincide.

For a script that deliberately treats evidence differences as a gate:

```sh
configtrace diff bad.ct.json good.ct.json --fail-on-diff
```

This is opt-in; ordinary `diff` prints a comparison without turning a discovered difference into an error. Incomplete/incomparable evidence returns a distinct outcome. Even a zero result only means no difference was established within the selected observations.

## Export before sharing

Raw trace files already contain masked values, but key names, relative paths, Node/platform versions, and other metadata may be sensitive. Export performs additional policy-based minimization.

The **built-in default** pseudonymizes every key name, reduces paths to basenames, removes OS PIDs and absolute start timestamps, and re-tokenizes value fingerprints:

```sh
configtrace export bad.ct.json --out issue.ct.json
```

For a pair that another developer needs to compare, export both together:

```sh
configtrace export bad.ct.json good.ct.json --out issue.share
```

The new directory contains `run-a.ct.json`, `run-b.ct.json`, `comparison.html`, and `manifest.json`. The input pair must share a comparison domain when comparisons are retained. Both outputs receive the same fresh export domain and token transformation. Exporting each run independently intentionally breaks their cross-export token correlation.

A less restrictive policy is included:

```sh
configtrace export bad.ct.json good.ct.json --policy policies/issue-share.yaml --out team-issue.share
```

```yaml
paths: basename              # relative | basename | omit
keys:
  redact: ["CUSTOMER_*", "INTERNAL_*"]
include:
  callSites: true
  loaders: true
  comparisons: true
metadata: minimal            # minimal | keep
```

This policy leaves other key names visible. `policies/minimal.yaml` removes paths and call sites and pseudonymizes every key. Unknown policy fields and YAML aliases are rejected. Export builds a new artifact rather than modifying its input. Existing files and export directories are not overwritten.

**Review the result before sharing.** A policy-based export is not a universal secret-safety certificate. It cannot recognize every sensitive filename or a secret deliberately inserted into an arbitrary metadata field. Trace content is not signed or authenticated; treat received artifacts as diagnostic claims, not tamper-proof proof.

## Child-process boundary

```sh
configtrace run --watch DATABASE_URL --children --out children.ct.json -- node server.cjs
```

Opt-in tracing injects the preload into supported **asynchronous direct Node** launches through the normalized `ChildProcess` spawn boundary. This is intended to cover ordinary `spawn`, `execFile`, and `fork`, including their shared underlying launch path. It is a private Node interface with runtime shape checks, not a universal process observer.

The implementation does not inject into shell/non-Node commands, synchronous child APIs, detached processes, Workers, native launchers, or arbitrary alternative Node binaries. Plain `exec("node ...")` is a shell boundary, not a supported direct launch.

Limits are four descendant levels and sixteen injected children per process. Artifact collection accepts at most 64 process streams. There is a bounded drain after the root exits; a surviving child or missing footer makes evidence partial. No process is automatically repaired, retried, or killed just to complete a trace. Grandchild history is not retroactively reconstructed.

## Options and exit behavior

| Option | Default / behavior |
| --- | --- |
| `--watch` | Required; 1–64 selectors; up to 256 distinct keys per recorder |
| `--out` | Required for capture/report/export; exclusive creation |
| `--key` | Omitted means an ephemeral single-run domain |
| `--no-dotenv` | Disables dotenv eager loading and its adapter |
| `--source-maps` | Off unless requested |
| `--children` | Off unless requested |
| `--max-events` | 5,000 per process; accepted range 10–100,000 |
| `--child-drain-ms` | 500 ms after root exit when children are enabled; range 0–5,000 |
| `--adapter` | Repeatable; up to eight trusted local adapters |

Application stdin/stdout/stderr are inherited. ConfigTrace does not store or sanitize those streams; its own status messages use a `[configtrace]` stderr prefix. Application logs, dotenv debug logging, runtime crash dumps, and shell transcripts are outside the masking boundary.

For `run`, the application's exit code remains the CLI's outcome. Signal termination is re-emitted on POSIX when possible; the fallback is `128 + signal number`. A failed artifact write after application completion is reported separately and does not replace the application's exit outcome. The library returns `artifactWritten: false` in that case. `run` is therefore **not** itself a reliable recorder-success gate; inspect the artifact or call `doctor` afterward.

Other command outcomes:

| Code | Meaning |
| --- | --- |
| `0` | Command completed; or opt-in diff found no established difference within comparable captured evidence |
| `2` | `diff --fail-on-diff` found evidence differences |
| `3` | Opt-in diff lacks comparable/complete/consistent coverage, or `doctor` reports incomplete capture |
| `64` | Invalid command or options |
| `65` | Invalid artifact/policy/key or incompatible comparison |
| `74` | Input/output or tool operation failure |
| `126` | Root Node launch could not be started |

These tool codes are not substituted for a successfully launched application's own nonzero exit code.

## Library and adapters

The CLI consumes the same modules exported by the package:

```js
const {
  readTrace, diffTraces, renderDiffHtml, sanitizeTraces, ExportPolicySchema,
} = require('./dist/index.js');

const bad = readTrace('bad.ct.json');
const good = readTrace('good.ct.json');
const comparison = diffTraces(bad, good);
const html = renderDiffHtml(bad, good, comparison);
const safePair = sanitizeTraces([bad, good], ExportPolicySchema.parse({ paths: 'omit' }));
```

The exported `run(options)` function also supports a caller-supplied environment for local test/demo orchestration. Its values are passed to the child but not added to trace metadata.

Trusted adapter contract:

```ts
interface ConfigTraceAdapter {
  id: string;
  install(context: AdapterContext): void | (() => void);
}
```

An adapter gets the active recorder and must delegate the application's original operation, then submit primitive observations through `recorder.observe`. Do not serialize raw values yourself. `examples/custom-adapter.cjs` shows the lifecycle contract:

```sh
configtrace run --watch DATABASE_URL --adapter ./examples/custom-adapter.cjs --out adapter.ct.json -- node app.cjs
```

Adapters are executable local code with the application's privileges. There is no sandbox. A trace or HTML report cannot request that an adapter be loaded. See [architecture](docs/ARCHITECTURE.md) and [security](SECURITY.md).

## Compatibility and known gaps

The dotenv adapter attempts the 16.x/17.x CommonJS export shape; the included fixture dependency is pinned to 17.2.3. It patches the cwd-resolved dotenv main export early so ordinary ESM imports can receive the wrappers, and uses a CJS load hook for additional matching instances. It **does not invoke `config()` itself**. Early module loading changes timing; use `--no-dotenv` when that is unacceptable. Other versions/shapes, bundled loader copies, and non-cwd ESM resolution may remain unobserved.

Every target in [the compatibility matrix](docs/COMPATIBILITY.md) is currently **unverified by execution**. Private hooks and Proxy replacement can affect application behavior or timing. Do not describe this release as transparent, zero-overhead, or production-safe.

Explicit exclusions include parent-shell history; Node internals and native addons; reads through a saved original `process.env` reference; descriptor/query operations that do not access a property value; replacement of `process.env`; late application exit-handler reads after finalization; Worker state; and compile-time browser substitutions such as a bundled `import.meta.env` value. No universal completeness claim is made.

There is no account system, hosted dashboard, cloud deployment, database, secret vault, AI model, VS Code extension, production agent, automatic fixer, or multi-language runtime support.

## Native Node tracing is an alternative

Node documents `--trace-env`, `--trace-env-js-stack`, and `--trace-env-native-stack`, introduced in Node 22.13 / 23.4. They report environment access names without printing values; native tracing also sees internal operations this JavaScript Proxy does not. Start there when an access log is sufficient. ConfigTrace's additional scope is supported loader evidence, deliberately paired value comparisons, structured explanations, and metadata-minimized issue artifacts—not the invention of environment-access tracing. See [Node's command-line documentation](https://nodejs.org/api/cli.html#--trace-env).

The implementation also references [Node environment semantics](https://nodejs.org/api/process.html#processenv), [preload behavior](https://nodejs.org/api/cli.html#-r---require-module), [source-map APIs](https://nodejs.org/api/module.html#source-map-support), [child process behavior](https://nodejs.org/api/child_process.html), and [dotenv's documented API](https://github.com/motdotla/dotenv#readme). Source documentation is not evidence that this implementation passed its fixtures.

## Repository and validation

```text
src/
  core/       Contracts, privacy, collection, analysis, export policy
  runtime/    Preload, watched environment Proxy, call sites, child boundary
  adapters/   dotenv observation
  report/     Offline HTML templates
  cli.ts      CLI entry point
  launcher.ts Direct Node launch and collection
fixtures/     Synthetic positive and negative reproductions
policies/     Share/export policy examples
tests/        Focused regression tests; 15 passed on the validated local target
docs/         Architecture, compatibility, validation, privacy and release notes
```

To repeat the core validation after dependency installation:

```sh
npm run build
npm test
```

The manual GitHub Actions workflow is `workflow_dispatch` only. It does not run on a push by default. No CI run was started in preparing this archive. Generated `dist` and `node_modules` remain excluded; the committed lockfile was produced by the validated dependency installation.

See [the validation plan](docs/VALIDATION.md), [release checklist](docs/RELEASE_CHECKLIST.md), and [contribution guide](CONTRIBUTING.md). No performance measurements or compatibility-pass counts are claimed.

## License

MIT. See [LICENSE](LICENSE). Dependency code is not vendored in this source archive and remains under its respective licenses.
