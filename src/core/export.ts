import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { TraceSchema, type Trace, type Observation, type SafeValue, type Notice } from './schema';
import { globToRegex } from './privacy';
import { readBounded, writeTrace, writeNew, UserError, uniqueId } from './io';
import { renderDiffHtml } from '../report/html';
import { diffTraces } from './analyze';

export const ExportPolicySchema = z.object({
  paths: z.enum(['relative', 'basename', 'omit']).default('basename'),
  keys: z.object({ redact: z.array(z.string().max(128)).max(64).default(['*']) }).strict().default({ redact: ['*'] }),
  include: z.object({ callSites: z.boolean().default(true), loaders: z.boolean().default(true), comparisons: z.boolean().default(true) }).strict()
    .default({ callSites: true, loaders: true, comparisons: true }),
  metadata: z.enum(['minimal', 'keep']).default('minimal'),
}).strict();
export type ExportPolicy = z.infer<typeof ExportPolicySchema>;
export function readExportPolicy(file?: string): ExportPolicy {
  if (!file) return ExportPolicySchema.parse({});
  try {
    const document = parseDocument(readBounded(file, 65536), { uniqueKeys: true, schema: 'core', strict: true });
    if (document.errors.length) throw new Error('Invalid policy');
    return ExportPolicySchema.parse(document.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid export policy. Unknown fields and YAML aliases are not allowed.', 65);
  }
}

/** Sanitization cannot certify arbitrary metadata as non-sensitive. Review exports before sharing. */
export function sanitizeTraces(inputs: Trace[], suppliedPolicy: ExportPolicy): Trace[] {
  const policy = ExportPolicySchema.parse(suppliedPolicy);
  const traces = inputs.map(t => TraceSchema.parse(t));
  if (!traces.length || traces.length > 2) throw new UserError('Export accepts one trace or one deliberately paired set.');
  if (traces.length === 2 && policy.include.comparisons &&
      (traces[0].comparison.mode === 'none' || traces[0].comparison.mode !== traces[1].comparison.mode || traces[0].comparison.domainId !== traces[1].comparison.domainId)) {
    throw new UserError('Pair export cannot establish equality across unrelated comparison domains. Export separately or disable comparisons.', 65);
  }
  const salt = randomBytes(32);
  const domainId = uniqueId('share');
  const keyMap = new Map<string, string>();
  const patterns = policy.keys.redact.map(p => globToRegex(p, traces.some(t => t.capture.caseMode === 'insensitive')));
  const names = [...new Set(traces.flatMap(t => [...t.events.flatMap(e => e.key ? [e.key] : []), ...t.capture.watch.filter(k => !/[*?]/.test(k))]))].sort();
  const occupied = new Set(names.map(n => n.toUpperCase()));
  let aliasNumber = 0;
  for (const name of names) {
    let alias = name;
    if (patterns.some(p => p.test(name))) {
      do { alias = `KEY_${++aliasNumber}`; } while (occupied.has(alias.toUpperCase()));
      occupied.add(alias.toUpperCase());
    }
    keyMap.set(name, alias);
  }
  const maskPath = (file: string): string | undefined => {
    if (policy.paths === 'omit') return undefined;
    if (file.startsWith('<external:')) return '<external>';
    if (path.isAbsolute(file) || path.win32.isAbsolute(file) || file.split(/[/\\]/).includes('..') || /^[a-z]+:\/\//i.test(file)) return '<outside-project>';
    return policy.paths === 'basename' ? file.split(/[/\\]/).at(-1) || '<unknown>' : file;
  };
  return traces.map(trace => {
    const pids = new Map(trace.processes.map((p, i) => [p.id, `p${i + 1}`]));
    const kept = trace.events.filter(e => policy.include.loaders || !['candidate', 'skip', 'load'].includes(e.operation));
    const ids = new Map(kept.map(e => [e.id, `${pids.get(e.processId)}:${e.seq}`]));
    const mask = (value: SafeValue | undefined, originalKey: string): SafeValue | undefined => {
      if (!value || value.state !== 'present') return value ? { ...value } : undefined;
      if (!policy.include.comparisons) return { state: 'omitted' };
      return { state: 'present', token: createHmac('sha256', salt).update(JSON.stringify([trace.comparison.domainId, originalKey, value.token])).digest('hex') };
    };
    const events: Observation[] = kept.map(e => {
      let origin = e.origin ? { ...e.origin, file: e.origin.file ? maskPath(e.origin.file) : undefined } : undefined;
      if (!policy.include.loaders && origin?.kind === 'dotenv') origin = { kind: 'unknown', confidence: 'unknown', file: undefined };
      const siteFile = e.site?.file ? maskPath(e.site.file) : undefined;
      return { ...e, id: ids.get(e.id)!, processId: pids.get(e.processId)!,
        childId: e.childId ? pids.get(e.childId) : undefined,
        key: e.key ? keyMap.get(e.key) : undefined,
        value: mask(e.value, e.key || ''), before: mask(e.before, e.key || ''), candidate: mask(e.candidate, e.key || ''),
        causedBy: e.causedBy ? ids.get(e.causedBy) : undefined, origin,
        site: policy.include.callSites && e.site && siteFile ? { ...e.site, file: siteFile } : undefined,
      };
    });
    const extra: Notice[] = ['metadata_scrubbed'];
    if (!policy.include.comparisons) extra.push('comparison_removed');
    if (!policy.include.loaders) extra.push('loader_details_removed');
    if (!policy.include.callSites) extra.push('call_sites_removed');
    const clean: Trace = {
      schemaVersion: trace.schemaVersion, toolVersion: trace.toolVersion, id: uniqueId('r'),
      comparison: { domainId, mode: policy.include.comparisons ? 'export-hmac' : 'none' },
      capture: { ...trace.capture, watch: [...new Set(events.flatMap(e => e.key ? [e.key] : []))].slice(0, 256),
        caseMode: trace.capture.caseMode, notices: [...new Set([...trace.capture.notices, ...extra])] },
      result: { ...trace.result }, coverage: trace.coverage.map(c => ({ ...c, reasons: [...c.reasons] })),
      processes: trace.processes.map(p => ({ ...p, id: pids.get(p.id)!, parentId: p.parentId ? pids.get(p.parentId) : undefined,
        pid: policy.metadata === 'keep' ? p.pid : null, ppid: policy.metadata === 'keep' ? p.ppid : null,
        startedAt: policy.metadata === 'keep' ? p.startedAt : undefined, entry: maskPath(p.entry) || '<omitted>' })),
      events, exported: true,
    };
    return TraceSchema.parse(clean);
  });
}

export function exportArtifacts(traces: Trace[], out: string, policy: ExportPolicy): string[] {
  const clean = sanitizeTraces(traces, policy);
  if (clean.length === 1) { writeTrace(out, clean[0]); return [out]; }
  const directory = path.resolve(out);
  try { fs.mkdirSync(directory, { recursive: false, mode: 0o700 }); }
  catch { throw new UserError('Pair-export output must be a new directory whose parent already exists.', 74); }
  try {
    const a = path.join(directory, 'run-a.ct.json'), b = path.join(directory, 'run-b.ct.json');
    writeTrace(a, clean[0]); writeTrace(b, clean[1]);
    const report = path.join(directory, 'comparison.html');
    writeNew(report, renderDiffHtml(clean[0], clean[1], diffTraces(clean[0], clean[1])));
    const manifest = path.join(directory, 'manifest.json');
    writeNew(manifest, JSON.stringify({ schemaVersion: 'configtrace-share/1', reviewRequired: true,
      files: ['run-a.ct.json', 'run-b.ct.json', 'comparison.html'],
      policySummary: { paths: policy.paths, keyNames: 'policy-applied', metadata: policy.metadata, ...policy.include },
      warning: 'Inspect key names, paths and application metadata before sharing. This is not a universal secret-safety certificate.' }, null, 2) + '\n');
    return [a, b, report, manifest];
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}
