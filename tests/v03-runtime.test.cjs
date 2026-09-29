// Source-only delivery: these tests were authored but NOT executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readTrace } = require('../dist/core/io.js');
const root = path.resolve(__dirname, '..');
function capture(entry, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-v03-fixture-'));
  const out = path.join(directory, 'run.ct.json');
  const env = { ...process.env };
  delete env.NODE_OPTIONS; delete env.CONFIGTRACE_FIXTURE;
  for (const k of Object.keys(env)) if (k.startsWith('__CONFIGTRACE_')) delete env[k];
  Object.assign(env, options.env || {});
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'dist/cli.js'), 'run', '--watch', 'CONFIGTRACE_FIXTURE', '--no-dotenv', '--out', out,
      ...(options.options || []), '--', process.execPath, ...(options.nodeOptions || []), path.join(root, 'fixtures', entry)],
      { cwd: root, env, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error); assert.ok(fs.existsSync(out), 'artifact must exist');
    return { status: result.status, stdout: result.stdout, trace: readTrace(out), raw: fs.readFileSync(out, 'utf8') };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
test('process.loadEnvFile emits native loader/before-after evidence without persisting fixture value', () => {
  const result = capture('native-env/app.cjs');
  assert.equal(result.status, 0);
  assert.ok(result.trace.events.some(e => e.operation === 'load' && e.loaderMethod === 'process.loadEnvFile'));
  assert.ok(result.trace.events.some(e => e.operation === 'write' && e.origin?.kind === 'native-env'));
  assert.ok(!result.raw.includes('synthetic-native-env-value'));
});
test('native existing-key candidate is reported conservatively as an inferred skip', () => {
  const result = capture('native-env/app.cjs', { env: { CONFIGTRACE_FIXTURE: 'synthetic-startup-value' } });
  assert.ok(result.trace.events.some(e => e.operation === 'skip' && e.origin?.confidence === 'inferred'));
});
test('early --env-file is declared without relabeling startup as known shell/file provenance', () => {
  const result = capture('native-env/startup.cjs', { nodeOptions: ['--env-file=' + path.join(root, 'fixtures/native-env/sample.env')] });
  assert.equal(result.status, 0);
  assert.ok(result.trace.events.some(e => e.operation === 'load' && e.phase === 'startup' && e.outcome === 'declared'));
  const baseline = result.trace.events.find(e => e.operation === 'baseline' && e.key === 'CONFIGTRACE_FIXTURE');
  assert.equal(baseline.origin.kind, 'startup'); assert.equal(baseline.origin.file, undefined);
});
test('native loader errors are passed through without persisting exception messages', () => {
  const result = capture('native-env/failure.cjs');
  assert.equal(result.status, 0); assert.match(result.stdout, /"nativeErrorPreserved":true/);
  assert.ok(result.trace.events.some(e => e.operation === 'load' && e.outcome === 'read-failed'));
});
test('opt-in copied, explicit, and SHARE_ENV Workers require distinct confirmed recorder streams', () => {
  const result = capture('worker-modes/parent.cjs', { options: ['--workers'] });
  assert.equal(result.status, 0); assert.match(result.stdout, /"sharedWriteVisible":true/);
  const workers = result.trace.processes.filter(p => p.role === 'worker');
  assert.equal(workers.length, 3); assert.equal(new Set(workers.map(p => p.id)).size, 3);
  assert.deepEqual(workers.map(p => p.environmentMode).sort(), ['copied', 'explicit', 'shared']);
  assert.ok(workers.every(p => result.trace.events.some(e => e.processId === p.id && e.operation === 'read')));
  assert.ok(!result.raw.includes('synthetic-shared-value'));
});
test('manual boundary records event identity without changing application exit code', () => {
  const result = capture('failure-boundary/app.cjs'); assert.equal(result.status, 17);
  const boundary = result.trace.events.find(e => e.operation === 'boundary');
  assert.equal(boundary.boundaryKind, 'manual');
  assert.ok(result.trace.events.some(e => e.operation === 'read' && e.seq > boundary.seq));
});
