// Source-only delivery: these tests were authored but NOT executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { traceOf } = require('./helpers.cjs');
const { createComparisonKey, fingerprint } = require('../dist/core/privacy.js');
const { TraceSchema } = require('../dist/core/schema.js');
const { buildProvenance } = require('../dist/analysis/provenance.js');
const { diagnoseTraces } = require('../dist/analysis/diagnose.js');
const { verifyTrace } = require('../dist/analysis/policy.js');
const { analyzeHistory } = require('../dist/analysis/history.js');
const { EvidenceMcpServer } = require('../dist/agent/server.js');
const { sanitizeTraces, ExportPolicySchema } = require('../dist/core/export.js');
const { renderTraceHtml, renderDiffHtml } = require('../dist/report/html.js');
const { nativeEnvFlags } = require('../dist/adapters/native-env.js');
function fixture(values, key = createComparisonKey()) {
  const t = traceOf(values, key);
  t.coverage = [{ feature: 'environment', status: 'limited', reasons: ['original_reference_bypass'] }];
  t.events.forEach(e => { e.origin = { kind: 'startup', confidence: 'inferred' }; });
  return t;
}
function assertDag(graph) {
  const incoming = new Map(graph.nodes.map(n => [n.id, 0]));
  const outgoing = new Map(graph.nodes.map(n => [n.id, []]));
  for (const e of graph.edges) { assert.ok(incoming.has(e.from) && incoming.has(e.to)); incoming.set(e.to, incoming.get(e.to) + 1); outgoing.get(e.from).push(e.to); }
  const queue = [...incoming].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) { const id = queue.pop(); visited++; for (const next of outgoing.get(id)) { incoming.set(next, incoming.get(next) - 1); if (incoming.get(next) === 0) queue.push(next); } }
  assert.equal(visited, graph.nodes.length);
}

test('v0.2 artifacts remain readable by the new reader', () => {
  const t = fixture(['synthetic']); t.schemaVersion = 'configtrace/1'; t.toolVersion = '0.2.0';
  t.events.forEach(e => delete e.value.empty);
  assert.equal(TraceSchema.parse(t).schemaVersion, 'configtrace/1');
});
test('DAG keeps startup ancestry unknown and never returns fingerprints', () => {
  const t = fixture(['synthetic']); t.events[0].operation = 'baseline';
  const graph = buildProvenance(t); assertDag(graph);
  assert.ok(graph.edges.some(e => e.relation === 'inherited' && e.confidence === 'unknown'));
  assert.ok(!JSON.stringify(graph).includes(t.events[0].value.token));
});
test('a forged spawn edge cannot point to its parent and create a cycle', () => {
  const t = fixture([]), root = t.processes[0];
  t.events.push({ id: root.id + ':0', processId: root.id, seq: 0, at: 0, operation: 'worker-spawn', childId: root.id, outcome: 'spawned', environmentMode: 'shared' });
  assert.throws(() => TraceSchema.parse(t));
  assertDag(buildProvenance(t));
});
test('diagnosis ranks changed values at common call sites without claiming a cause', () => {
  const key = createComparisonKey(), a = fixture(['synthetic-a'], key), b = fixture(['synthetic-b'], key);
  const result = diagnoseTraces(a, b);
  assert.equal(result.findings[0].key, 'DATABASE_URL');
  assert.equal(result.findings[0].evidence.readValueChanged, true);
  assert.equal(result.boundary.kind, 'not-recorded');
  assert.match(result.conclusion, /no root cause has been proven/);
});
test('manual boundary excludes reads captured only after the boundary', () => {
  const key = createComparisonKey(), a = fixture(['same', 'different'], key), b = fixture(['same', 'same'], key);
  a.events[1].operation = 'boundary'; delete a.events[1].key; delete a.events[1].value;
  a.events[1].boundaryKind = 'manual';
  a.events.push({ ...b.events[1], id: a.processes[0].id + ':2', seq: 2, at: 2, value: fingerprint(key, 'DATABASE_URL', 'different') });
  const result = diagnoseTraces(a, b); assert.equal(result.boundary.seq, 1); assert.equal(result.findings.length, 0);
});
test('unrelated domains remain incomparable', () => {
  const result = diagnoseTraces(fixture(['same']), fixture(['same']));
  assert.equal(result.sameDomain, false); assert.equal(result.status, 'incomplete-or-incomparable');
});
test('configuration verification distinguishes pass, violation, and incomplete evidence', () => {
  const policy = { rules: { DATABASE_URL: { required: true, read: 'required' } } };
  assert.equal(verifyTrace(fixture(['value']), policy).exitCode, 0);
  assert.equal(verifyTrace(fixture([undefined]), policy).exitCode, 2);
  const partial = fixture(['value']); partial.capture.status = 'partial';
  assert.equal(verifyTrace(partial, policy).exitCode, 3);
});
test('transient changes after first read violate immutability even if value changes back', () => {
  const result = verifyTrace(fixture(['a', 'b', 'a']), { rules: { DATABASE_URL: { immutableAfterFirstRead: true } } });
  assert.equal(result.exitCode, 2);
});
test('unknown source and unmatched wildcard are not passing source/absence assertions', () => {
  const t = fixture(['value']); t.events[0].origin = { kind: 'unknown', confidence: 'unknown' };
  assert.equal(verifyTrace(t, { rules: { DATABASE_URL: { allowedOrigins: ['startup'] } } }).exitCode, 3);
  assert.equal(verifyTrace(t, { rules: { 'NOT_CAPTURED_*': { missing: true } } }).exitCode, 3);
});
test('paired provenance honors minimum confidence', () => {
  const a = fixture(['a']), b = fixture(['a']);
  const result = verifyTrace(a, { rules: { DATABASE_URL: { consistentProvenance: true, minimumConfidence: 'observed' } } }, { reference: b });
  assert.equal(result.exitCode, 3);
});
test('source contracts on transformed exports remain inconclusive', () => {
  const policy = ExportPolicySchema.parse({ keys: { redact: [] } });
  const [clean] = sanitizeTraces([fixture(['value'])], policy);
  assert.equal(verifyTrace(clean, { rules: { DATABASE_URL: { allowedOrigins: ['startup'] } } }).exitCode, 3);
});
test('history detects first source/site change and coverage regression', () => {
  const key = createComparisonKey(), a = fixture(['a'], key), b = fixture(['a'], key);
  b.events[0].origin = { kind: 'dotenv', file: '.env.production', confidence: 'inferred' };
  b.events[0].site.file = 'src/new-client.ts'; b.capture.status = 'partial';
  const result = analyzeHistory([{ label: '001', trace: a }, { label: '002', trace: b }]);
  assert.equal(result.firstDivergence[0].run, 1); assert.equal(result.coverageRegressions[0].run, 1);
  assert.ok(result.transitions[0].changes[0].newReadSites.length);
});
test('MCP initialization gates tools and returns only authorized, token-free evidence', () => {
  const trace = fixture(['CANARY-RAW-VALUE']), server = new EvidenceMcpServer(new Map([['broken', trace]]));
  const request = (id, method, params) => server.handle({ jsonrpc: '2.0', id, method, params });
  assert.equal(request(1, 'tools/list', {}).error.code, -32002);
  assert.equal(request(2, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }).result.protocolVersion, '2025-11-25');
  server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(request(3, 'tools/list', {}).result.tools.length, 6);
  const output = request(4, 'tools/call', { name: 'explain_key', arguments: { trace: 'broken', key: 'DATABASE_URL' } });
  const raw = JSON.stringify(output);
  assert.equal(output.result.isError, false);
  assert.ok(!raw.includes('CANARY-RAW-VALUE')); assert.ok(!raw.includes(trace.events[0].value.token)); assert.ok(!raw.includes(trace.comparison.domainId));
  const denied = request(5, 'tools/call', { name: 'explain_key', arguments: { trace: '/etc/passwd', key: 'DATABASE_URL' } });
  assert.equal(denied.result.isError, true);
});
test('native startup flags are parsed as declarations, not inferred from eval text', () => {
  assert.deepEqual(nativeEnvFlags(['--eval', '--env-file=not-a-flag', '--env-file=real.env', '--env-file-if-exists', 'optional.env']), [
    { method: '--env-file', file: 'real.env' }, { method: '--env-file-if-exists', file: 'optional.env' },
  ]);
});
test('new report preserves CSP/escaping and does not embed fingerprints', () => {
  const key = createComparisonKey(), a = fixture(['a'], key), b = fixture(['b'], key);
  a.events[0].site.file = '</script><img src=x onerror=alert(1)>';
  for (const html of [renderTraceHtml(a), renderDiffHtml(a, b)]) {
    assert.ok(html.includes('Content-Security-Policy')); assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes(a.events[0].value.token)); assert.ok(!html.includes(b.events[0].value.token));
  }
});
