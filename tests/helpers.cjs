const { createComparisonKey, fingerprint } = require('../dist/core/privacy.js');
const { SCHEMA_VERSION, TOOL_VERSION } = require('../dist/core/schema.js');
function traceOf(values, key = createComparisonKey(), name = 'DATABASE_URL') {
  const processId = 'p_aaaaaaaaaaaaaaaaaaaaaaaa';
  const events = values.map((value, i) => ({
    id: `${processId}:${i}`, processId, seq: i, at: i,
    operation: 'read', key: name, value: fingerprint(key, name, value),
    origin: { kind: 'unknown', confidence: 'unknown' }, purpose: 'application',
    site: { file: 'src/database.ts', line: 3, column: 1, mapping: 'source-map' },
  }));
  return {
    schemaVersion: SCHEMA_VERSION, toolVersion: TOOL_VERSION, id: 'r_fixture',
    comparison: { domainId: key.domainId, mode: 'hmac-sha256' },
    capture: { status: 'complete', watch: [name], caseMode: 'sensitive', maxEventsPerProcess: 5000, notices: [] },
    result: { exitCode: 0, signal: null },
    processes: [{ id: processId, role: 'root', pid: 123, ppid: 1, node: 'v22.14.0', platform: 'linux',
      entry: 'src/database.ts', ended: true, exitCode: 0, eventsDropped: 0 }],
    coverage: [], events, exported: false,
  };
}
module.exports = { traceOf };
