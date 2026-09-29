#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { run } from './launcher';
import { readTrace, writeNew, UserError, terminalSafe } from './core/io';
import { TOOL_VERSION } from './core/schema';
import { writeComparisonKey } from './core/privacy';
import { evidenceFor, explainText, diffTraces, diffText } from './core/analyze';
import { renderTraceHtml, renderDiffHtml } from './report/html';
import { readExportPolicy, exportArtifacts } from './core/export';
import { buildProvenance } from './analysis/provenance';
import { diagnoseTraces, diagnosisText } from './analysis/diagnose';
import { verifyTrace, verificationText, readVerificationPolicy } from './analysis/policy';
import { addHistory, analyzeHistory, readHistory, historyText } from './analysis/history';
import { loadAuthorizedTraces, serveMcp } from './agent/server';
import { adapterCatalog } from './adapters/registry';
import { createDemo } from './demo';

const HELP = `ConfigProof ${TOOL_VERSION} — local configuration provenance and forensics

  configproof keygen --out .configtrace/pair.key.json
  configproof run --watch DATABASE_URL --key .configtrace/pair.key.json --out bad.ct.json -- node app.mjs
  configproof explain DATABASE_URL --from bad.ct.json [--process ID] [--format text|json]
  configproof graph bad.ct.json [--key DATABASE_URL] [--process ID] [--out graph.json]
  configproof diff bad.ct.json good.ct.json [--format text|json|html] [--out FILE]
  configproof diagnose bad.ct.json good.ct.json [--format text|json] [--before-seq N] [--limit N]
  configproof verify bad.ct.json --policy configtrace-policy.yaml [--reference good.ct.json]
  configproof report bad.ct.json [good.ct.json] --out report.html
  configproof export bad.ct.json [good.ct.json] --out issue.ct.json [--policy FILE]
  configproof history add run.ct.json --dir .configtrace/history
  configproof history analyze .configtrace/history [--order filename|started-at] [--max-runs N]
  configproof mcp --trace broken=bad.ct.json --trace working=good.ct.json
  configproof adapters [--format text|json]
  configproof doctor --from bad.ct.json [--format text|json]
  configproof demo stale-env [--out new-directory]

run options:
  --watch KEY,OTHER_KEY  Repeatable; * and ? patterns (quote patterns in your shell).
  --key FILE            Private comparison key. Omit for an unpaired ephemeral domain.
  --compare-with FILE   Check --key against an earlier raw trace, not recover its secret.
  --out FILE            Required. Outputs are exclusively created, never overwritten.
  --cwd DIR             Application working directory (default: current directory).
  --children            Bounded asynchronous direct Node child capture, opt-in.
  --workers             Bounded Worker capture, opt-in; copied, explicit, and SHARE_ENV.
  --max-workers N       Session-wide instrumented Worker creation cap, 1–32 (default 16).
  --source-maps         Enable source-map cache and original-source attribution.
  --no-dotenv           Disable the eager dotenv adapter.
  --no-native-env       Disable native Node env-file observations (enabled by default).
  --max-events N        Events per context, 10–100000 (default 5000).
  --child-drain-ms N    Bounded descendant drain, 0–5000 (default 500).
  --adapter FILE        Repeatable trusted local CommonJS adapter; never from artifacts.

diff/diagnose: --left-process ID and --right-process ID select contexts explicitly.
  diff --fail-on-diff returns 2 for differences, 3 for incomparable/incomplete evidence.
verify: --process ID, --reference-process ID, --format text|json, --out FILE.
  Always returns 0 pass, 2 violation, 3 inconclusive. Invalid input is a separate error.
diagnose: Ranking is not proof of causality. Without a marker, failure timing is unknown.
history: Filename order by default, not inferred execution chronology. No automatic deletion.
mcp: Stdio, read-only, explicit artifact aliases. No arbitrary paths, raw values, or shell tool.

Run locally with selected configuration keys and review artifacts before sharing.
No telemetry, hosted service, automatic fixes, raw-value output, or build-time tracing.
`;
const definitions = {
  watch: { type: 'string' as const, multiple: true }, key: { type: 'string' as const },
  'compare-with': { type: 'string' as const }, out: { type: 'string' as const }, cwd: { type: 'string' as const },
  children: { type: 'boolean' as const }, workers: { type: 'boolean' as const }, 'max-workers': { type: 'string' as const },
  'source-maps': { type: 'boolean' as const }, 'no-dotenv': { type: 'boolean' as const }, 'no-native-env': { type: 'boolean' as const },
  'max-events': { type: 'string' as const }, 'child-drain-ms': { type: 'string' as const }, adapter: { type: 'string' as const, multiple: true },
  from: { type: 'string' as const }, format: { type: 'string' as const }, policy: { type: 'string' as const },
  process: { type: 'string' as const }, 'left-process': { type: 'string' as const }, 'right-process': { type: 'string' as const },
  reference: { type: 'string' as const }, 'reference-process': { type: 'string' as const },
  'before-seq': { type: 'string' as const }, limit: { type: 'string' as const },
  dir: { type: 'string' as const }, order: { type: 'string' as const }, 'max-runs': { type: 'string' as const },
  trace: { type: 'string' as const, multiple: true }, 'fail-on-diff': { type: 'boolean' as const }, help: { type: 'boolean' as const, short: 'h' },
} as const;
const allowed: Record<string, string[]> = {
  keygen: ['out'], run: ['watch','key','compare-with','out','cwd','children','workers','max-workers','source-maps','no-dotenv','no-native-env','max-events','child-drain-ms','adapter'],
  explain: ['from','process','format','out'], graph: ['key','process','out'],
  diff: ['format','out','left-process','right-process','fail-on-diff'],
  diagnose: ['format','out','left-process','right-process','before-seq','limit'],
  verify: ['policy','process','reference','reference-process','format','out'],
  report: ['out','left-process','right-process'], export: ['out','policy'],
  history: ['dir','order','max-runs','format','out'], mcp: ['trace'], adapters: ['format','out'],
  doctor: ['from','format','out'], demo: ['out'],
};
async function main(): Promise<void> {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || command === '--help' || command === '-h') { process.stdout.write(HELP); return; }
  if (command === '--version') { process.stdout.write(TOOL_VERSION + '\n'); return; }
  if (!Object.prototype.hasOwnProperty.call(allowed, command)) throw new UserError('Unknown command. Run configproof --help.');
  const boundary = args.indexOf('--');
  const ownArgs = boundary < 0 ? args : args.slice(0, boundary);
  if (ownArgs.includes('--help') || ownArgs.includes('-h')) { process.stdout.write(HELP); return; }
  let program: string[] = [];
  if (command === 'run') {
    if (boundary < 0) throw new UserError('Separate the Node command with --.');
    program = args.splice(boundary + 1); args.splice(boundary);
  }
  const parsed = (() => {
    try { return parseArgs({ args, options: definitions, allowPositionals: true, strict: true }); }
    catch { throw new UserError('Invalid command options. Run configproof --help.'); }
  })();
  const { values: v, positionals: p } = parsed;
  if (v.help) { process.stdout.write(HELP); return; }
  for (const option of Object.keys(v)) if (!allowed[command].includes(option)) throw new UserError('An option is not supported by this command. Run configproof --help.');
  const requireOut = () => { if (!v.out) throw new UserError('--out is required.'); return path.resolve(v.out); };
  const count = (min: number, max = min) => { if (p.length < min || p.length > max) throw new UserError('Wrong number of arguments. Run configproof --help.'); };
  const output = (text: string) => { if (v.out) writeNew(v.out, text); else process.stdout.write(text); };
  const format = (choices: string[]) => { const kind = v.format || 'text'; if (!choices.includes(kind)) throw new UserError('Unsupported output format.'); return kind; };
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  const pairOptions = { leftProcess: v['left-process'], rightProcess: v['right-process'] };
  switch (command) {
    case 'keygen': count(0); writeComparisonKey(requireOut()); process.stdout.write('Private pair key created. Do not commit or share it.\n'); break;
    case 'run': {
      count(0);
      const result = await run({ command: program, watch: v.watch || [], out: requireOut(), cwd: v.cwd,
        keyFile: v.key, compareWith: v['compare-with'], children: v.children, workers: v.workers,
        maxWorkers: v['max-workers'] === undefined ? undefined : Number(v['max-workers']),
        sourceMaps: v['source-maps'], dotenv: !v['no-dotenv'], nativeEnv: !v['no-native-env'],
        maxEvents: v['max-events'] === undefined ? undefined : Number(v['max-events']),
        childDrainMs: v['child-drain-ms'] === undefined ? undefined : Number(v['child-drain-ms']), adapters: v.adapter });
      process.stderr.write(result.artifactWritten ? `[configproof] ${result.trace.capture.status} artifact written. Application output was not captured or sanitized.\n` : '[configproof] Artifact write failed. Application outcome is preserved.\n');
      if (result.signal) {
        if (process.platform !== 'win32') { try { process.kill(process.pid, result.signal); return; } catch { /* numeric fallback */ } }
        process.exitCode = 128 + (os.constants.signals[result.signal] || 1);
      } else process.exitCode = result.exitCode ?? 1;
      break;
    }
    case 'explain': {
      count(1); if (!v.from) throw new UserError('--from is required.');
      const trace = readTrace(v.from), graph = buildProvenance(trace, { key: p[0], processId: v.process });
      output(format(['text','json']) === 'json' ? json({ ...evidenceFor(trace, p[0], v.process), provenance: graph })
        : explainText(trace, p[0], v.process) + `\nProvenance: ${graph.nodes.length} nodes, ${graph.edges.length} links${graph.truncated ? ' (limited)' : ''}. Use --format json for the DAG.\n`);
      break;
    }
    case 'graph': count(1); output(json(buildProvenance(readTrace(p[0]), { key: v.key, processId: v.process }))); break;
    case 'diff': {
      count(2); const left = readTrace(p[0]), right = readTrace(p[1]), result = diffTraces(left, right, pairOptions);
      const kind = format(['text','json','html']);
      if (kind === 'html') writeNew(requireOut(), renderDiffHtml(left, right, result));
      else output(kind === 'json' ? json(result) : diffText(result));
      if (v['fail-on-diff']) process.exitCode = !result.sameDomain || !result.completeStreams || !result.leftProcess || !result.rightProcess || result.coverageChanged ? 3 : result.changed ? 2 : 0;
      break;
    }
    case 'diagnose': {
      count(2); const result = diagnoseTraces(readTrace(p[0]), readTrace(p[1]), { ...pairOptions,
        beforeSeq: v['before-seq'] === undefined ? undefined : Number(v['before-seq']), limit: v.limit === undefined ? undefined : Number(v.limit) });
      output(format(['text','json']) === 'json' ? json(result) : diagnosisText(result)); break;
    }
    case 'verify': {
      count(1); if (!v.policy) throw new UserError('--policy is required.');
      const result = verifyTrace(readTrace(p[0]), readVerificationPolicy(v.policy), { processId: v.process,
        reference: v.reference ? readTrace(v.reference) : undefined, referenceProcess: v['reference-process'] });
      output(format(['text','json']) === 'json' ? json(result) : verificationText(result)); process.exitCode = result.exitCode; break;
    }
    case 'report': {
      count(1,2); const a = readTrace(p[0]), b = p[1] ? readTrace(p[1]) : undefined;
      writeNew(requireOut(), b ? renderDiffHtml(a, b, diffTraces(a, b, pairOptions)) : renderTraceHtml(a)); break;
    }
    case 'export': {
      count(1,2); const files = exportArtifacts(p.map(readTrace), requireOut(), readExportPolicy(v.policy));
      process.stdout.write(`Created ${files.length} export file(s). Review metadata before sharing.\n`); break;
    }
    case 'history': {
      count(2);
      if (p[0] === 'add') {
        if (!v.dir) throw new UserError('history add needs --dir.');
        if (v.order || v['max-runs']) throw new UserError('Ordering options apply to history analyze, not add.');
        const file = addHistory(p[1], v.dir); output(format(['text','json']) === 'json' ? json({ created: file }) : terminalSafe(`Saved history snapshot: ${file}`) + '\n');
      } else if (p[0] === 'analyze') {
        if (v.dir) throw new UserError('Pass the history directory as the analyze argument, not --dir.');
        const order = v.order || 'filename';
        if (order !== 'filename' && order !== 'started-at') throw new UserError('--order must be filename or started-at.');
        const entries = readHistory(p[1], { order, maxRuns: v['max-runs'] === undefined ? undefined : Number(v['max-runs']) });
        const result = analyzeHistory(entries, order); output(format(['text','json']) === 'json' ? json(result) : historyText(result));
      } else throw new UserError('History actions: add or analyze.');
      break;
    }
    case 'mcp': count(0); await serveMcp(loadAuthorizedTraces(v.trace || [])); break;
    case 'adapters': {
      count(0); const catalog = adapterCatalog(); output(format(['text','json']) === 'json' ? json(catalog)
        : terminalSafe(catalog.map(a => `${a.manifest.id}: ${a.state}\n  ${a.manifest.supportedVersions}\n  ${a.manifest.knownBypasses.join('; ')}`).join('\n'), true) + '\n'); break;
    }
    case 'doctor': {
      count(0); if (!v.from) throw new UserError('--from is required.'); const trace = readTrace(v.from);
      output(format(['text','json']) === 'json' ? json({ capture: trace.capture, coverage: trace.coverage, adapters: trace.adapters || [], processes: trace.processes })
        : terminalSafe(`Capture: ${trace.capture.status}\n${trace.coverage.map(c => `${c.feature}: ${c.status} — ${c.reasons.join(', ')}`).join('\n')}\nNotices: ${trace.capture.notices.join(', ')}\n`, true));
      process.exitCode = trace.capture.status === 'complete' ? 0 : 3; break;
    }
    case 'demo': count(1); if (p[0] !== 'stale-env') throw new UserError('Available demo: stale-env.'); process.stdout.write(`Synthetic demo written to ${terminalSafe(await createDemo(v.out))}\n`); break;
  }
}
main().catch(error => {
  const safe = error instanceof UserError ? error : new UserError('ConfigProof could not complete the operation. No raw exception details were printed.', 74);
  process.stderr.write(`[configproof] ${safe.message}\n`); process.exitCode = safe.exitCode;
});
