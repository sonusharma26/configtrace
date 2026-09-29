# Validation guide

## First local checks

```sh
npm install --ignore-scripts
npm run typecheck
npm run build
npm test
```

These commands passed locally for the v0.3.1 release snapshot. Repeat them in a clean checkout and on each supported Node runtime before publishing. Resolve actual failures before marking anything complete. Use synthetic values and an isolated development directory.

## Extended acceptance checklist

- [ ] Compile the entire package and generated declarations on each supported Node/types target.
- [ ] Re-run preserved v0.2 tests: env operation semantics, dotenv source handling, custom targets, paired export, failed streams, children, source maps, stdout/exit preservation, metadata escaping.
- [ ] Read actual saved v0.2 artifacts and reject malformed v0.3 event/context references.
- [ ] Prove DAG acyclicity over fixtures, repeated source/read sites, parent/child/Worker edges, and malicious ancestry.
- [ ] Verify native runtime apply/skip/failure, option hints, missing files, optional files, Buffer/file-URL arguments, file races, parser-unavailable fallbacks, ESM imports, earlier references and disabling the adapter.
- [ ] Compare instrumented and uninstrumented Worker outputs across copied, explicit, SHARE_ENV, nested, eval, execArgv overrides, constructor failures, depth/count limits, termination, missing footers, Windows key case and concurrent mutation.
- [ ] Confirm no original environment or workerData rewriting, no added Worker error listener, and preserved application errors.
- [ ] Check policy 0/2/3 results for missing/empty/present, unread keys, post-first-read transient changes, inferred/unknown sources, forbidden loaders, transformed exports, pair mismatch and partial coverage.
- [ ] Check deterministic diagnosis ordering, shared/unrelated domains, missing sites, explicit/uncaught/no marker, post-boundary reads, and no fabricated causal verdict.
- [ ] Check history ordering, first divergence in supplied series, new read sites, source/loader/mutation changes, coverage regressions, absent timestamps, file permissions/symlinks and budgets.
- [ ] Open single/pair reports offline; inspect CSP, no requests, filtering, context selection, graph/timeline jumps, truncation notices, keyboard use and malicious metadata escaping.
- [ ] Exercise MCP initialization/notifications/ping, supported and unsupported versions, fixed tool list, schemas, unauthorized aliases, paging, oversize input/output, EOF, invalid JSON, and protocol-only stdout.
- [ ] Connect actual target coding clients. No client is considered verified until its specific configuration/handshake/tool calls are recorded.
- [ ] Seed synthetic secrets in every value/exception/input path; inspect all created artifacts, reports, exports, and protocol responses. Separately confirm application stdout remains unsanitized.
- [ ] Exercise malicious metadata and same-user tampering assumptions. Ensure documentation does not overclaim artifact authenticity.
- [ ] Measure overhead, event loss and storage growth on named fixtures; publish actual raw results, not estimates.
- [ ] Review dependency versions, security advisories, workflow action pins, runtime hooks and publication configuration.

## Test material

`tests/core.test.cjs` and `tests/integration.test.cjs` preserve the earlier acceptance sources. `tests/v03-analysis.test.cjs` covers new pure analysis/schema/report/agent behavior. `tests/v03-runtime.test.cjs` covers selected native loader/Worker/boundary paths. The automated suite passed locally, but these focused tests are not a substitute for the extended checks above.

Fixtures use synthetic values only. `fixtures/v03-manifest.json` lists the new cases. Verify the GitHub workflow independently for each release.

## Results record

When executing, record: date, OS, exact Node version, installed dependency lockfile, commit/source digest, command, actual result, artifacts, interpretation, and unresolved cases. Keep failures visible. Do not label a passing policy as proof of complete runtime provenance.
