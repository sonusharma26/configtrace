'use strict';
const { createHmac } = require('node:crypto');
const secret = Buffer.alloc(32, 7); // Synthetic, public fixture key; never used for a user trace.
function value(name, raw) {
  if (raw === undefined) return { state: 'missing' };
  return { state: 'present', empty: raw === '', token: createHmac('sha256', secret).update('configtrace:value:v1\0')
    .update(String(Buffer.byteLength(name))).update(':').update(name).update(':').update(raw).digest('hex') };
}
function makeTrace(count = 1000, keyCount = 8, revision = 0) {
  if (count > 100000 || count < keyCount || keyCount < 1 || keyCount > 64) throw new Error('Fixture exceeds supported trace limits.');
  const pid = 'p_aaaaaaaaaaaaaaaaaaaaaaaa';
  const keys = Array.from({ length: keyCount }, (_, i) => `CONFIG_${i}`);
  const events = [];
  const latest = new Map();
  for (let seq = 0; seq < count; seq++) {
    const key = keys[seq % keys.length];
    const operation = seq < keyCount ? 'baseline' : seq % 37 === 0 ? 'write' : seq % 29 === 0 ? 'skip' : seq % 31 === 0 ? 'candidate' : 'read';
    const raw = key === 'CONFIG_0' ? `synthetic-value-${revision}-${Math.floor(seq / 71) % 2}` : key === 'CONFIG_1' ? '' : `synthetic-value-${key}`;
    const event = { id: `${pid}:${seq}`, processId: pid, seq, at: seq / 100, operation, key, value: value(key, raw),
      origin: { kind: operation === 'baseline' ? 'startup' : operation === 'skip' || operation === 'candidate' ? 'dotenv' : 'runtime',
        confidence: operation === 'read' ? 'inferred' : 'observed',
        ...(operation === 'skip' || operation === 'candidate' ? { file: '.env.test' } : {}) },
      ...(operation === 'read' ? { purpose: seq % 43 === 0 ? 'loader' : 'application' } : {}),
      ...(operation !== 'baseline' ? { site: { file: `src/config-${seq % 3}.ts`, line: 10 + seq % 5, column: 3, mapping: 'generated' } } : {}),
      ...(operation === 'skip' ? { outcome: 'not-applied', candidate: value(key, 'synthetic-candidate') } : {}) };
    if (operation === 'read' && latest.has(key)) event.causedBy = latest.get(key);
    if (operation === 'baseline' || operation === 'write') latest.set(key, event.id);
    events.push(event);
  }
  return { schemaVersion: 'configtrace/2', toolVersion: '0.3.1', id: `r_fixture_${revision}`,
    comparison: { domainId: 'd_fixture', mode: 'hmac-sha256' },
    capture: { status: 'complete', watch: keys, caseMode: 'sensitive', maxEventsPerProcess: 100000, notices: [] },
    result: { exitCode: 0, signal: null },
    processes: [{ id: pid, role: 'root', pid: 1, ppid: 0, node: 'v22.16.0', platform: 'linux', entry: 'app.cjs',
      ended: true, exitCode: 0, eventsDropped: 0 }],
    coverage: [{ feature: 'environment', status: 'limited', reasons: ['original_reference_bypass'] }],
    exported: false, events };
}
module.exports = { makeTrace, value };
