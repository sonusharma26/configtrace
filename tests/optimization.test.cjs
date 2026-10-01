'use strict';
require('../scripts/register-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { makeTrace } = require('../bench/fixtures.cjs');
const { TraceIndex } = require('../src/core/event-index.ts');
const fast = require('../src/core/analyze.ts');
const legacy = require('../bench/oracle/analyze.ts');
const { diagnoseTraces } = require('../src/analysis/diagnose.ts');
const oldDiagnose = require('../bench/oracle/diagnose.ts').diagnoseTraces;
const privacy = require('../src/core/privacy.ts');
const { readLinesBounded, AggregateReadLimit } = require('../src/core/json-lines.ts');
const { buildProvenance } = require('../src/analysis/provenance.ts');
const oldProvenance = require('../bench/oracle/provenance.ts').buildProvenance;
const { renderTraceHtml, renderDiffHtml } = require('../src/report/html.ts');
const { captureSite } = require('../src/runtime/callsite.ts');
const root = path.resolve(__dirname, '..');
const packageVersion = require('../package.json').version;

// Seven grouped checks, intentionally separate from the full release suite.
test('watch fast path and prepared fingerprints retain selection/equality semantics', () => {
  for (const insensitive of [false, true]) for (const patterns of [['DATABASE_URL','TOKEN'], ['DB_*','SERVICE_?','TOKEN'], ['SS','I','s'], ['Ω']]) {
    const watch = new privacy.WatchSet(patterns, insensitive);
    const regex = patterns.map(p => privacy.globToRegex(p, insensitive));
    for (const key of ['DATABASE_URL','database_url','TOKEN','token','DB_A','SERVICE_X','SERVICE_XX','ß','ı','ſ','Ω','ω','OTHER','TOKEN\n','TOKEN\r\n','TOKEN\u2028','__CONFIGTRACE_SESSION', Symbol('x'), 'a'.repeat(129)]) {
      const expected = typeof key === 'string' && key.length <= 128 && !key.toUpperCase().startsWith('__CONFIGTRACE_') && regex.some(r => r.test(key));
      assert.equal(watch.matches(key), expected);
    }
  }
  const key = { version: 1, domainId: 'd_test', secret: '01'.repeat(32) };
  const prepared = privacy.createFingerprinter(key);
  for (const name of ['DATABASE_URL','I','数据库']) for (const raw of [undefined, '', 'x', 'x:y', '🧪']) {
    assert.deepEqual(prepared(name, raw), privacy.fingerprint(key, name, raw));
    if (raw !== undefined) {
      const expected = crypto.createHmac('sha256', Buffer.from(key.secret, 'hex')).update('configtrace:value:v1\0')
        .update(String(Buffer.byteLength(name))).update(':').update(name).update(':').update(raw).digest('hex');
      assert.equal(prepared(name, raw).token, expected);
    }
  }
  assert.notDeepEqual(prepared('K','before'), prepared('K','after'));
});

test('single-pass indexes match legacy evidence and do not create hidden stale caches', () => {
  const trace = makeTrace(1000, 16);
  const worker = 'p_bbbbbbbbbbbbbbbbbbbbbbbb';
  trace.processes.push({ ...trace.processes[0], id: worker, role: 'worker', parentId: trace.processes[0].id, caseMode: 'sensitive' });
  trace.processes[0].caseMode = 'insensitive';
  trace.events.push({ ...trace.events[0], id: `${worker}:0`, processId: worker, seq: 0, key: 'Config_0' });
  const index = new TraceIndex(trace);
  assert.equal(index.eventsVisited, trace.events.length);
  for (const key of index.keys(index.processFor())) index.summary(index.evidence(key,index.processFor()));
  assert.ok(index.summaryReferences <= 16384);
  assert.ok(index.summaries.size <= 64);
  for (const pid of [undefined, worker]) for (const key of ['CONFIG_0','config_0','Config_0','ABSENT'])
    assert.deepEqual(fast.evidenceFor(trace, key, pid, index), legacy.evidenceFor(trace, key, pid));
  assert.throws(() => fast.evidenceFor(trace, 'CONFIG_0', 'p_missing', index));
  assert.throws(() => fast.evidenceFor(structuredClone(trace), 'CONFIG_0', undefined, index));
  const oldCount = fast.evidenceFor(trace, 'CONFIG_0').events.length;
  trace.events.push({ ...trace.events[0], operation: 'read', id: `${trace.processes[0].id}:1001`, seq: 1001 });
  assert.equal(fast.evidenceFor(trace, 'CONFIG_0').events.length, oldCount + 1);
});

test('diff, diagnosis and bounded provenance preserve legacy output and determinism', () => {
  for (const mode of ['normal','unrelated','partial','missing','empty']) {
    const a = makeTrace(1200, 16, 0), b = makeTrace(1200, 16, 1);
    if (mode === 'unrelated') b.comparison.domainId = 'd_other';
    if (mode === 'partial') { a.capture.status = 'partial'; a.processes[0].ended = false; }
    if (mode === 'missing') b.events = [];
    if (mode === 'empty') { a.events = []; b.events = []; a.processes = []; b.processes = []; }
    const diff = fast.diffTraces(a,b);
    assert.deepEqual(diff, legacy.diffTraces(a,b));
    assert.equal(fast.diffText(diff), legacy.diffText(legacy.diffTraces(a,b)));
    const diagnosis = diagnoseTraces(a,b);
    assert.deepEqual(diagnosis, oldDiagnose(a,b));
    assert.deepEqual(diagnoseTraces(a,b), diagnosis);
    const options = { allProcesses: true, maxNodes: 150, maxEdges: 500 };
    assert.deepEqual(buildProvenance(a, options), oldProvenance(a, options));
    if (a.events.length) assert.deepEqual(diagnoseTraces(a,b,{ beforeSeq: 400 }), oldDiagnose(a,b,{ beforeSeq: 400 }));
  }
});

test('incremental reader handles UTF-8 boundaries, final records, bounds, mutation and early close', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configproof-lines-'));
  const file = path.join(dir, 'stream.jsonl');
  try {
    const lines = [JSON.stringify({ value: 'x'.repeat(65522) + '🧪数据库' }), '', JSON.stringify({ value: 'x'.repeat(130000) }), '{"last":true}'];
    fs.writeFileSync(file, lines.join('\n'));
    assert.deepEqual([...readLinesBounded(file, { maxBytes: 300000 })], lines);
    assert.throws(() => [...readLinesBounded(file,{ maxBytes: 4 })]);
    assert.throws(() => [...readLinesBounded(file,{ maxBytes: 300000, remainingBytes: 4 })], AggregateReadLimit);
    const iterator = readLinesBounded(file,{ maxBytes: 300000 }); iterator.next();
    fs.appendFileSync(file, '\n{"changed":true}');
    assert.throws(() => [...iterator]);
    if (process.platform !== 'win32') {
      const alias = path.join(dir, 'alias'); fs.symlinkSync(file,alias);
      assert.throws(() => [...readLinesBounded(alias,{ maxBytes: 300000 })]);
    }
    let closed = 0; const original = fs.closeSync;
    fs.closeSync = (...args) => { closed++; return original(...args); };
    try { for (const line of readLinesBounded(file,{ maxBytes: 300000 })) { assert.ok(line); break; } }
    finally { fs.closeSync = original; }
    assert.equal(closed, 1);
  } finally { fs.rmSync(dir,{ recursive:true,force:true }); }
});

test('path and callsite caches are bounded, strip queries and restore stack hooks', () => {
  const scrubber = new privacy.PathScrubber(root, 'synthetic-salt');
  const originalPrepare = Error.prepareStackTrace, originalLimit = Error.stackTraceLimit;
  for (let i = 0; i < 520; i++) scrubber.scrub(`src/file-${i}.ts?credential=DO_NOT_RETAIN`);
  assert.equal(scrubber.cache.size, 512);
  assert.ok([...scrubber.cache.entries.keys()].every(k => !k.includes('DO_NOT_RETAIN')));
  assert.equal(scrubber.scrub('src/file.ts?x=1'), 'src/file.ts');
  const site = captureSite(scrubber, false);
  assert.ok(site.file.endsWith('optimization.test.cjs'));
  assert.equal(Error.prepareStackTrace, originalPrepare); assert.equal(Error.stackTraceLimit, originalLimit);
  const moduleApi = require('node:module'), originalFind = moduleApi.findSourceMap;
  let calls = 0, active = false;
  const map = { findEntry() { calls++; return { originalSource: 'mapped.ts', originalLine: 9, originalColumn: 2 }; } };
  moduleApi.findSourceMap = () => active ? map : undefined;
  try {
    const sites = [];
    for (let i = 0; i < 4; i++) { active = i > 0; sites.push(captureSite(scrubber, true)); }
    assert.equal(sites[0].mapping, 'unavailable'); assert.equal(sites[1].mapping, 'source-map');
    assert.equal(calls, 1); sites[1].file = 'tampered'; assert.notEqual(sites[2].file, 'tampered');
  } finally { moduleApi.findSourceMap = originalFind; }
});

test('compact reports retain displayed IDs, escape metadata and hash their fixed scripts', () => {
  const a = makeTrace(2200, 16), b = makeTrace(2200, 16, 1);
  a.events[0].site = { file: 'bad</script><script>INJECT_ME()</script>&\u2028.ts', line: 1, mapping:'generated' };
  for (const html of [renderTraceHtml(a), renderDiffHtml(a,b)]) {
    assert.equal((html.match(/<script\b/g) || []).length, 2);
    assert.ok(!html.includes('<script>INJECT_ME()'));
    assert.ok(!html.includes(a.events[0].value.token));
    assert.ok(!html.includes('synthetic-value-'));
    const data = html.match(/<script type="application\/json" id="ct-evidence-data">([\s\S]*?)<\/script>/)[1];
    const payload = JSON.parse(data);
    assert.equal(payload.version, 1); assert.ok(payload.timelines.flat().length > 0);
    assert.ok(!data.includes('<'));
    const executable = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    new Function(executable); // Syntax only, not a browser-interoperability claim.
    const digest = crypto.createHash('sha256').update(executable).digest('base64');
    assert.ok(html.includes(`sha256-${digest}`));
    assert.ok(html.includes("connect-src &#39;none&#39;"));
    assert.ok(!executable.includes('innerHTML'));
    assert.ok(!/<(?:script|img|link)\b[^>]*(?:src|href)=['"]https?:/i.test(html));
  }
  const html = renderTraceHtml(a);
  const payload = JSON.parse(html.match(/id="ct-evidence-data">([\s\S]*?)<\/script>/)[1]);
  const ids = payload.timelines.flat().map(row => payload.strings[row[0]]);
  assert.deepEqual(ids, a.events.slice(0,2000).map(e => `event-${e.id}`));
  assert.ok(html.includes('2000 / 2200 events'));
});

test('CLI help/version and key generation do not load unrelated subsystems', () => {
  const cli = path.join(root,'src/cli.ts'), loader = path.join(root,'scripts/register-source.cjs');
  for (const argument of ['--version','--help']) {
    const result = spawnSync(process.execPath,['--require',loader,cli,argument],{ encoding:'utf8',timeout:15000 });
    assert.equal(result.status,0,result.stderr);
    assert.ok(result.stdout.includes(argument === '--version' ? packageVersion : 'configproof run'));
  }
  const source = fs.readFileSync(cli,'utf8');
  const imports = source.split('\n').filter(line => line.startsWith('import '));
  assert.ok(imports.every(line => !/report|agent|policy|history|provenance|schema|launcher/.test(line)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'configproof-keygen-'));
  try {
    const result = spawnSync(process.execPath,['--require',loader,cli,'keygen','--out',path.join(dir,'pair.key.json')],{ encoding:'utf8',timeout:15000 });
    assert.equal(result.status,0,result.stderr);
    assert.match(JSON.parse(fs.readFileSync(path.join(dir,'pair.key.json'),'utf8')).secret,/^[a-f0-9]{64}$/);
  } finally { fs.rmSync(dir,{ recursive:true,force:true }); }
});
