#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { run } from './launcher';
import { readTrace, writeNew, UserError, terminalSafe } from './core/io';
import { writeComparisonKey } from './core/privacy';
import { evidenceFor, explainText, diffTraces, diffText } from './core/analyze';
import { renderTraceHtml, renderDiffHtml } from './report/html';
import { readExportPolicy, exportArtifacts } from './core/export';
import { createDemo } from './demo';

const HELP = `ConfigTrace 0.2.0 — local environment evidence for Node.js

  configtrace keygen --out .configtrace/pair.key.json
  configtrace run --watch DATABASE_URL --key .configtrace/pair.key.json --out bad.ct.json -- node app.mjs
  configtrace explain DATABASE_URL --from bad.ct.json
  configtrace diff bad.ct.json good.ct.json [--format text|json|html] [--out comparison.html]
  configtrace report bad.ct.json --out report.html
  configtrace export bad.ct.json --out issue.ct.json [--policy policies/issue-share.yaml]
  configtrace export bad.ct.json good.ct.json --out issue.share [--policy policy.yaml]
  configtrace doctor --from bad.ct.json
  configtrace demo stale-env [--out new-directory]

run options:
  --watch KEY,OTHER_KEY  Repeatable; * and ? patterns supported (quote them in your shell).
  --key FILE            Private comparison key. Omit for an ephemeral, unpaired run.
  --compare-with FILE   Verify --key matches an earlier raw trace. Does not recover its secret.
  --out FILE            Required output. Existing files are never overwritten.
  --cwd DIR             Application working directory (default: current directory).
  --children            Opt in to bounded asynchronous direct Node children.
  --source-maps         Enable Node source-map caching and original-source attribution.
  --no-dotenv           Disable the eager dotenv adapter; environment tracing still works.
  --max-events N        Per-process event cap, 10–100000 (default 5000).
  --child-drain-ms N    Bounded drain after root exits, 0–5000 (default 500).
  --adapter FILE        Repeatable trusted local CommonJS adapter. Never loaded from artifacts.

explain: --process ID selects a recorded child. --format text|json.
diff: --left-process ID / --right-process ID select processes explicitly.
      --fail-on-diff returns 2 for differences, 3 for incomparable/incomplete evidence.

No shell expansion, raw value output, automatic fixes, network service, or telemetry.
A complete artifact is not universal coverage. See README.md for limitations.
`;

const definitions = {
  watch: { type: 'string' as const, multiple: true }, key: { type: 'string' as const },
  'compare-with': { type: 'string' as const }, out: { type: 'string' as const }, cwd: { type: 'string' as const },
  children: { type: 'boolean' as const }, 'source-maps': { type: 'boolean' as const },
  'no-dotenv': { type: 'boolean' as const }, 'max-events': { type: 'string' as const },
  'child-drain-ms': { type: 'string' as const }, adapter: { type: 'string' as const, multiple: true },
  from: { type: 'string' as const }, format: { type: 'string' as const }, policy: { type: 'string' as const },
  process: { type: 'string' as const }, 'left-process': { type: 'string' as const }, 'right-process': { type: 'string' as const },
  'fail-on-diff': { type: 'boolean' as const }, help: { type: 'boolean' as const, short: 'h' },
} as const;
const allowed: Record<string, string[]> = {
  keygen: ['out'], run: ['watch','key','compare-with','out','cwd','children','source-maps','no-dotenv','max-events','child-drain-ms','adapter'],
  explain: ['from','process','format','out'], diff: ['format','out','left-process','right-process','fail-on-diff'],
  report: ['out'], export: ['out','policy'], doctor: ['from'], demo: ['out'],
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') { process.stdout.write(HELP); return; }
  if (command === '--version') { process.stdout.write('0.2.0\n'); return; }
  if (!allowed[command]) throw new UserError('Unknown command. Run configtrace --help.');
  const boundary = args.indexOf('--');
  const ownArgs = boundary < 0 ? args : args.slice(0, boundary);
  if (ownArgs.includes('--help') || ownArgs.includes('-h')) { process.stdout.write(HELP); return; }
  let program: string[] = [];
  if (command === 'run') {
    const separator = args.indexOf('--');
    if (separator < 0) throw new UserError('Separate the Node application command with --.');
    program = args.splice(separator + 1);
    args.splice(separator);
  }
  const parsed = (() => {
    try { return parseArgs({ args, options: definitions, allowPositionals: true, strict: true }); }
    catch { throw new UserError('Invalid command options. Run configtrace --help.'); }
  })();
  const { values: v, positionals: p } = parsed;
  if (v.help) { process.stdout.write(HELP); return; }
  for (const option of Object.keys(v)) if (!allowed[command].includes(option)) throw new UserError('An option is not supported by this command. Run configtrace --help.');
  const requireOut = () => { if (!v.out) throw new UserError('--out is required.'); return path.resolve(v.out); };
  const count = (min: number, max = min) => { if (p.length < min || p.length > max) throw new UserError('Wrong number of arguments. Run configtrace --help.'); };
  const output = (text: string) => { if (v.out) writeNew(v.out, text); else process.stdout.write(text); };
  const format = (choices: string[]) => { const value = v.format || 'text'; if (!choices.includes(value)) throw new UserError('Unsupported output format.'); return value; };

  switch (command) {
    case 'keygen': {
      count(0); writeComparisonKey(requireOut());
      process.stdout.write('Private pair key created. Do not commit or share it.\n'); break;
    }
    case 'run': {
      count(0);
      const result = await run({ command: program, watch: v.watch || [], out: requireOut(), cwd: v.cwd,
        keyFile: v.key, compareWith: v['compare-with'], children: v.children, sourceMaps: v['source-maps'], dotenv: !v['no-dotenv'],
        maxEvents: v['max-events'] === undefined ? undefined : Number(v['max-events']),
        childDrainMs: v['child-drain-ms'] === undefined ? undefined : Number(v['child-drain-ms']), adapters: v.adapter });
      process.stderr.write(result.artifactWritten
        ? `[configtrace] ${result.trace.capture.status} artifact written. Raw application output was not captured or sanitized.\n`
        : '[configtrace] Unable to write the artifact. Application exit outcome is preserved.\n');
      if (result.signal) {
        if (process.platform !== 'win32') { try { process.kill(process.pid, result.signal); return; } catch { /* numeric fallback */ } }
        process.exitCode = 128 + (os.constants.signals[result.signal] || 1);
      } else process.exitCode = result.exitCode ?? 1;
      break;
    }
    case 'explain': {
      count(1); if (!v.from) throw new UserError('--from is required.');
      const trace = readTrace(v.from);
      output(format(['text','json']) === 'json' ? JSON.stringify(evidenceFor(trace, p[0], v.process), null, 2) + '\n' : explainText(trace, p[0], v.process));
      break;
    }
    case 'diff': {
      count(2); const left = readTrace(p[0]), right = readTrace(p[1]);
      const result = diffTraces(left, right, { leftProcess: v['left-process'], rightProcess: v['right-process'] });
      const kind = format(['text','json','html']);
      if (kind === 'html') writeNew(requireOut(), renderDiffHtml(left, right, result));
      else output(kind === 'json' ? JSON.stringify(result, null, 2) + '\n' : diffText(result));
      if (v['fail-on-diff']) process.exitCode = !result.sameDomain || !result.completeStreams || !result.leftProcess || !result.rightProcess || result.coverageChanged ? 3 : result.changed ? 2 : 0;
      break;
    }
    case 'report': count(1); writeNew(requireOut(), renderTraceHtml(readTrace(p[0]))); break;
    case 'export': {
      count(1,2); const files = exportArtifacts(p.map(readTrace), requireOut(), readExportPolicy(v.policy));
      process.stdout.write(`Created ${files.length} export file(s). Review key names, paths and metadata before sharing.\n`); break;
    }
    case 'doctor': {
      count(0); if (!v.from) throw new UserError('--from is required.'); const trace = readTrace(v.from);
      process.stdout.write(terminalSafe(`Capture: ${trace.capture.status}\n${trace.coverage.map(c => `${c.feature}: ${c.status} — ${c.reasons.join(', ')}`).join('\n')}\nNotices: ${trace.capture.notices.join(', ')}\n`, true));
      process.exitCode = trace.capture.status === 'complete' ? 0 : 3; break;
    }
    case 'demo': {
      count(1); if (p[0] !== 'stale-env') throw new UserError('Available demo: stale-env.');
      const folder = await createDemo(v.out);
      process.stdout.write(`Synthetic demo written to ${terminalSafe(folder)}\nOpen comparison.html or run explain on bad.ct.json.\n`); break;
    }
  }
}
main().catch(error => {
  const safe = error instanceof UserError ? error : new UserError('ConfigTrace could not complete the operation. No raw exception details were printed.', 74);
  process.stderr.write(`[configtrace] ${safe.message}\n`);
  process.exitCode = safe.exitCode;
});
