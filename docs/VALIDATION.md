# Validation plan — not executed

No dependency installation, build, type check, test, demo, browser rendering, benchmark or CI execution was performed while preparing this archive. The repository contains test **sources** and fixtures for later validation. All acceptance results remain pending.

Use synthetic values and a disposable working directory first. Do not begin with production secrets.

## 1. Establish the local toolchain

From the repository root:

```sh
npm install --ignore-scripts
npm run build
npm test
```

These are instructions for a future local run, not commands that have already passed. Record the actual Node, npm and OS versions. `npm install` will generate a real lockfile; review and commit it for a release. The archive intentionally does not include a fabricated lockfile or generated `dist`.

`npm run typecheck` is available for a separate no-emit check. The build also performs TypeScript checking. There is no need to run a type check after every small edit; validate a coherent checkpoint.

The `workflow_dispatch` workflow in `.github/workflows/validate.yml` is opt-in and has not been triggered. It is not configured to build on every push.

## 2. Focused test-source inventory

| Area | Intended regression coverage | Result |
| --- | --- | --- |
| Key/value primitives | Keyed equality, missing versus empty, fixture canary absence | Not run |
| Selection | Glob syntax, key-case handling, internal-key exclusion | Not run |
| Schemas | Raw field rejection, invalid causal links | Not run |
| Comparison | Intermediate read changes, unrelated domains | Not run |
| Export | Pair equality preserved; fresh export identity; metadata minimization | Not run |
| HTML | Escaped malicious metadata, no full value tokens | Not run |
| Collection | Interrupted JSONL becomes partial, not success | Not run |
| Files | Existing outputs are not overwritten | Not run |
| Runtime | Stale inheritance, mutations/deletion/empty values | Not run |
| Application outcome | Exit 17 and original stdout/stderr | Not run |
| dotenv | CJS/ESM paths and custom target | Not run |
| Processes | Bounded async direct Node children; Worker exclusion | Not run |

The small suite protects the central contracts. It is not exhaustive browser, adversarial, cross-platform, Node-version, dependency-version or performance validation.

## 3. End-to-end synthetic acceptance

After a successful build and test run:

```sh
node dist/cli.js demo stale-env --out .configtrace/validation-demo
node dist/cli.js explain DATABASE_URL --from .configtrace/validation-demo/bad.ct.json
node dist/cli.js diff .configtrace/validation-demo/bad.ct.json .configtrace/validation-demo/good.ct.json
node dist/cli.js doctor --from .configtrace/validation-demo/bad.ct.json
```

Use a new output directory each time. The demo creates synthetic data and a private pair key in that directory. Do not share the key.

Expected diagnostic story, subject to validation:

- Bad run: a value is already present at startup; a dotenv candidate is not applied; an application read links to the startup state with inferred confidence.
- Good run: startup state is missing; dotenv supplies an observed assignment; the subsequent application read links to it.
- Diff: present values can be compared because both runs share the pair key, and origin/loader differences are visible.
- Unknown parent-shell history and unsupported native/Worker coverage are visible in both artifacts.

Open `comparison.html` manually in a browser. Check narrow/mobile layout, keyboard focus, filtering, long path wrapping, CSP console messages, escaped special characters and absence of network requests. This browser exercise has not been performed.

## 4. Deliberate negative cases

### Missing and empty

The mutation fixture exercises setting, deletion, empty string and `defineProperty`:

```sh
node dist/cli.js run --watch CONFIGTRACE_FIXTURE --out mutation.ct.json -- node fixtures/runtime-mutation/app.cjs
```

Confirm that a missing state does not display as the same state as an empty present value. Keep read order: an intermediate change is relevant even when the final value returns to its earlier token.

### Unpaired artifacts

Capture the same synthetic app twice without `--key`. Value comparison must be incomparable rather than “same” merely because display labels match. `diff --fail-on-diff` should return 3 for this case, not a false pass.

### Source-map fixture

Compile this separate fixture only when validation is authorized:

```sh
npx --no-install tsc -p fixtures/source-map/tsconfig.json
node dist/cli.js run --watch DATABASE_URL --source-maps --out mapped.ct.json -- node fixtures/source-map/generated/input.js
node dist/cli.js explain DATABASE_URL --from mapped.ct.json
```

Check attribution against the actual `input.ts` read at line 3. Remove or invalidate the map and confirm that the tool falls back to a generated position without inventing a TypeScript location.

### Earlier original-reference bypass

On a POSIX shell, after building, use a temporary `NODE_OPTIONS` value for this single command:

```sh
NODE_OPTIONS="--require $(pwd)/fixtures/bypass/early.cjs" node dist/cli.js run --watch CONFIGTRACE_FIXTURE --out bypass.ct.json -- node fixtures/bypass/app.cjs
```

The example assumes the repository path contains no spaces; otherwise quote the Node option's path appropriately. Restore any pre-existing shell setup rather than permanently changing it. The early preload captures the original environment before ConfigTrace. Its later invisible mutation must not be falsely attributed to an observed write. This is a limitation test, not a tracing success case.

### Workers and unsupported children

Use the Worker fixture and direct-child fixture with and without `--children`. Workers should remain outside coverage. Also manually exercise a shell command, `execFileSync`, a detached process, an explicit custom environment, and an exiting parent with a still-running child. Missing child history must remain partial/unknown. Do not leave intentionally detached processes running after a local exercise.

### Application exit and recorder failure

Run the exit-code fixture and compare stdout/stderr and exit status with and without instrumentation. Force a final artifact write failure in an isolated directory and check that a successfully launched application's exit code is preserved while `artifactWritten` is false. Reject a pre-existing `--out` file before starting the application. Verify signals separately on POSIX and Windows; do not assume the same termination semantics.

## 5. Privacy checks

Use unique synthetic canary strings, not real credentials. Cover inherited values, file candidates, overwritten values, deleted values and low-entropy values. After capture, search **all generated artifact/export/report files and recorder diagnostic output** for those exact canaries.

Application logs are deliberately outside this check's success boundary: a fixture that prints a canary itself will still print it. Keep that distinction visible rather than “fixing” the test by intercepting application output.

Also check:

- Key files and temporary session secrets are absent from exported directories.
- Two independently exported bundles use different domains and do not expose the original fingerprints.
- A jointly exported pair retains only the intended equality relationships.
- Minimal export does not retain raw key names, absolute user directories, PIDs or wall-clock start dates.
- Malicious key/path text is escaped in HTML and scrubbed in terminal output.
- YAML aliases and unknown policy fields are rejected.
- Oversized, malformed, truncated and extra-field artifacts fail safely or become explicitly partial as appropriate.
- POSIX key-file permissions reject group/world-readable keys; Windows ACL expectations are documented and manually examined.

These checks have not been run, so this archive has no demonstrated leak-test pass.

## 6. Behavioral and overhead gate

Run the same deterministic application with and without instrumentation using a fixed synthetic environment. Compare return code, stdout, stderr and application-visible behavior. Include both `--no-dotenv` and the default eager-adapter path. Differences in order, module timing or behavior are release blockers unless explicitly narrowed out of support.

For performance, choose a tiny startup fixture and a read-heavy fixture. Warm up consistently, then collect repeated runs on the same named machine/Node version. Report median and tail startup/runtime time, event count, bytes written, truncation and raw measurements. Separate source-map and child-tracing overhead. Do not extrapolate a fixture result into a universal percentage.

## 7. Practical usefulness gate

Use at least three independently supplied or realistically reproduced configuration failures. Compare the tool with native Node env tracing, static configuration inspection and ordinary logging. Record whether the evidence shortened diagnosis and whether users correctly understood unknown coverage. This is a proposed experiment, not an adoption claim.

Only after the gates above should the compatibility matrix be updated from “unverified.”
