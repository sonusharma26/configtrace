const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readTrace } = require('../dist/core/io.js');
const { writeComparisonKey } = require('../dist/core/privacy.js');
const { diffTraces } = require('../dist/core/analyze.js');
const repo = path.resolve(__dirname, '..');
const cli = path.join(repo, 'dist/cli.js');

function launch(name, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-integration-'));
  const out = path.join(directory, 'run.ct.json');
  const keyFile = path.join(directory, 'pair.key.json');
  writeComparisonKey(keyFile);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (['NODE_OPTIONS','DATABASE_URL','CONFIGTRACE_FIXTURE'].includes(key.toUpperCase())) delete env[key];
  }
  Object.assign(env, options.env || {});
  const app = path.join(repo, 'fixtures', name, options.entry || 'app.cjs');
  const args = [cli, 'run', '--watch', options.watch || 'CONFIGTRACE_FIXTURE', '--key', keyFile, '--out', out,
    ...(options.children ? ['--children', '--child-drain-ms', '0'] : []), '--', process.execPath, app];
  try {
    const child = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', timeout: 15000 });
    assert.ok(!child.error, 'CLI invocation should finish');
    assert.ok(fs.existsSync(out), 'CLI should produce an artifact');
    const raw = fs.readFileSync(out, 'utf8');
    return { status: child.status, stdout: child.stdout, stderr: child.stderr, trace: readTrace(out), raw };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('stale dotenv value produces candidate-not-applied evidence without persisting its value', () => {
  const canary = 'PRIVATE_SYNTHETIC_DATABASE_CANARY';
  const result = launch('stale-inheritance', { watch: 'DATABASE_URL', env: { DATABASE_URL: canary } });
  assert.equal(result.status, 0);
  assert.ok(result.trace.events.some(e => e.operation === 'skip' && e.key === 'DATABASE_URL'));
  const reads = result.trace.events.filter(e => e.operation === 'read' && e.purpose === 'application');
  assert.ok(reads.some(e => e.origin?.kind === 'startup'));
  assert.ok(!result.raw.includes(canary));
});

test('mutation, deletion, empty values and property definition remain distinguishable', () => {
  const result = launch('runtime-mutation');
  assert.equal(result.status, 0);
  assert.ok(result.trace.events.some(e => e.operation === 'delete'));
  const reads = result.trace.events.filter(e => e.operation === 'read' && e.key === 'CONFIGTRACE_FIXTURE');
  assert.ok(reads.some(e => e.value.state === 'missing'));
  assert.ok(reads.filter(e => e.value.state === 'present').length >= 3);
});

test('application stdout, stderr and nonzero exit are retained', () => {
  const result = launch('exit-code');
  assert.equal(result.status, 17);
  assert.equal(result.trace.result.exitCode, 17);
  assert.ok(result.stdout.includes('application-stdout'));
  assert.ok(result.stderr.includes('application-stderr'));
});

test('ESM application with cwd-resolvable dotenv receives loader evidence', () => {
  const result = launch('esm', { watch: 'DATABASE_URL', entry: 'app.mjs' });
  assert.equal(result.status, 0);
  assert.ok(result.trace.events.some(e => e.operation === 'write' && e.origin?.kind === 'dotenv'));
});

test('opt-in asynchronous direct Node children have separate process identities', () => {
  const result = launch('child-process', { entry: 'parent.cjs', children: true });
  assert.equal(result.status, 0);
  assert.equal(result.trace.processes.length, 3);
  assert.equal(new Set(result.trace.processes.map(p => p.id)).size, 3);
  assert.ok(result.trace.processes.filter(p => p.role === 'child').every(p => p.parentId));
});

test('custom dotenv targets are not attributed to the real process environment', () => {
  const result = launch('custom-target', { watch: 'DATABASE_URL' });
  assert.equal(result.status, 0);
  assert.ok(result.trace.capture.notices.includes('dotenv_custom_target'));
  assert.ok(!result.trace.events.some(e => e.operation === 'write' && e.origin?.kind === 'dotenv'));
});

test('Worker execution is explicitly outside the process capture', () => {
  const result = launch('worker', { entry: 'parent.cjs', children: true });
  assert.equal(result.status, 0);
  assert.equal(result.trace.processes.length, 1);
  assert.ok(result.trace.coverage.some(c => c.feature === 'workers' && c.status === 'unsupported'));
});
