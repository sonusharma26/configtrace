const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { traceOf } = require('./helpers.cjs');
const { createComparisonKey, fingerprint, WatchSet } = require('../dist/core/privacy.js');
const { TraceSchema } = require('../dist/core/schema.js');
const { diffTraces, compareValue } = require('../dist/core/analyze.js');
const { sanitizeTraces, ExportPolicySchema } = require('../dist/core/export.js');
const { renderTraceHtml } = require('../dist/report/html.js');
const { collectTrace } = require('../dist/core/collect.js');
const { writeNew, readBounded } = require('../dist/core/io.js');

test('privacy tokens distinguish missing, empty, value and unrelated pairing keys', () => {
  const a = createComparisonKey(), b = createComparisonKey();
  assert.deepEqual(fingerprint(a, 'KEY', undefined), { state: 'missing' });
  assert.equal(compareValue(fingerprint(a, 'KEY', ''), fingerprint(a, 'KEY', undefined), true), 'different');
  assert.deepEqual(fingerprint(a, 'KEY', 'canary'), fingerprint(a, 'KEY', 'canary'));
  assert.notDeepEqual(fingerprint(a, 'KEY', 'canary'), fingerprint(b, 'KEY', 'canary'));
  assert.notDeepEqual(fingerprint(a, 'KEY', 'canary'), fingerprint(a, 'OTHER', 'canary'));
  assert.ok(!JSON.stringify(traceOf(['DO_NOT_PERSIST_THIS_SYNTHETIC_VALUE'], a)).includes('DO_NOT_PERSIST_THIS_SYNTHETIC_VALUE'));
});

test('watch filters are literal/glob based, case-aware and exclude internal controls', () => {
  const watch = new WatchSet(['DB_*', 'PORT'], true);
  assert.ok(watch.matches('db_host'));
  assert.ok(!watch.matches('UNRELATED'));
  assert.ok(!new WatchSet(['*'], false).matches('__CONFIGTRACE_CONFIG'));
  assert.equal(watch.canonical('db_host'), 'DB_HOST');
});

test('strict artifacts reject raw-value additions and invalid evidence links', () => {
  const trace = traceOf(['synthetic']);
  assert.ok(TraceSchema.safeParse(trace).success);
  trace.events[0].rawValue = 'MUST_BE_REJECTED';
  assert.ok(!TraceSchema.safeParse(trace).success);
  delete trace.events[0].rawValue;
  trace.events[0].causedBy = 'nonexistent';
  assert.ok(!TraceSchema.safeParse(trace).success);
});

test('diff detects intermediate divergence and refuses unrelated present-value equality', () => {
  const key = createComparisonKey();
  const a = traceOf(['first', 'intermediate-a', 'first'], key);
  const b = traceOf(['first', 'intermediate-b', 'first'], key);
  const diff = diffTraces(a, b);
  assert.equal(diff.rows[0].lastRead, 'same');
  assert.equal(diff.rows[0].readSequence, 'different');
  assert.ok(diff.changed);
  const unrelated = diffTraces(a, traceOf(['first', 'intermediate-a', 'first']));
  assert.equal(unrelated.sameDomain, false);
  assert.equal(unrelated.rows[0].lastRead, 'incomparable');
});

test('paired exports re-key values consistently, scrub metadata, and cannot be correlated by token across exports', () => {
  const key = createComparisonKey();
  const originals = [traceOf(['synthetic-secret'], key), traceOf(['synthetic-secret'], key)];
  const policy = ExportPolicySchema.parse({ paths: 'omit' });
  const pair = sanitizeTraces(originals, policy);
  assert.equal(pair[0].events[0].value.token, pair[1].events[0].value.token);
  assert.notEqual(pair[0].events[0].value.token, originals[0].events[0].value.token);
  assert.ok(!JSON.stringify(pair).includes('DATABASE_URL'));
  assert.equal(pair[0].processes[0].pid, null);
  assert.equal(pair[0].events[0].site, undefined);
  assert.equal(diffTraces(...pair).rows[0].lastRead, 'same');
  const another = sanitizeTraces(originals, policy);
  assert.notEqual(pair[0].events[0].value.token, another[0].events[0].value.token);
});

test('offline HTML escapes executable metadata and never embeds value tokens', () => {
  const trace = traceOf(['synthetic']);
  trace.events[0].site.file = '</script><img src=x onerror=alert(1)>';
  const html = renderTraceHtml(trace);
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(!html.includes(trace.events[0].value.token));
});

test('collector preserves complete records but reports interrupted streams as partial', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-collect-test-'));
  try {
    const trace = traceOf(['synthetic']), process = trace.processes[0];
    fs.writeFileSync(path.join(directory, process.id + '.jsonl'),
      JSON.stringify({ type: 'start', process: { ...process, ended: false, exitCode: null } }) + '\n' +
      JSON.stringify({ type: 'event', event: trace.events[0] }) + '\n' + '{"type":');
    const key = createComparisonKey();
    const config = { directory, rootId: process.id, runId: 'r_collect', watch: ['DATABASE_URL'], maxEvents: 5000,
      maxBytes: 8 * 1024 * 1024, comparison: key };
    const recovered = collectTrace(config, { exitCode: null, signal: 'SIGKILL' });
    assert.equal(recovered.capture.status, 'partial');
    assert.equal(recovered.events.length, 1);
    assert.ok(recovered.capture.notices.includes('missing_footer'));
    assert.ok(TraceSchema.safeParse(recovered).success);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exclusive output creation never overwrites an existing file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-output-test-'));
  try {
    const out = path.join(directory, 'artifact.json');
    writeNew(out, 'original');
    assert.throws(() => writeNew(out, 'replacement'));
    assert.equal(readBounded(out), 'original');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
