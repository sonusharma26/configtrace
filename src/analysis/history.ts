import fs from 'node:fs';
import path from 'node:path';
import type { Trace } from '../core/schema';
import { diffTraces, originLabel, siteLabel } from '../core/analyze';
import { readTrace, writeTrace, UserError, terminalSafe } from '../core/io';

export interface HistoryEntry { label: string; trace: Trace; processId?: string }
export interface DriftChange {
  key: string; changes: string[]; newReadSites: string[]; newOrigins: string[];
  newMutationSites: string[]; sourceRun: number; targetRun: number;
}
export interface HistoryAnalysis {
  schemaVersion: 'configtrace-history/1'; ordering: 'provided' | 'filename' | 'started-at'; rawValuesAvailable: false;
  runs: Array<{ index: number; label: string; traceId: string; capture: Trace['capture']['status'] }>;
  transitions: Array<{ from: number; to: number; sameDomain: boolean; complete: boolean; coverageChanged: boolean; changes: DriftChange[] }>;
  firstDivergence: Array<{ key: string; run: number; label: string }>;
  coverageRegressions: Array<{ run: number; reasons: string[] }>;
  caveats: string[];
}
/** The caller supplies order; this function never infers chronology from an OS PID or mtime. */
export function analyzeHistory(entries: HistoryEntry[], ordering: HistoryAnalysis['ordering'] = 'provided'): HistoryAnalysis {
  if (entries.length < 2 || entries.length > 100) throw new UserError('History analysis needs 2–100 explicitly ordered traces.');
  const totalEvents = entries.reduce((n, e) => n + e.trace.events.length, 0);
  if (totalEvents > 250000) throw new UserError('History analysis exceeds the 250000 aggregate event budget. Select fewer runs.', 65);
  const transitions: HistoryAnalysis['transitions'] = [];
  const first = new Map<string, number>();
  const regressions: HistoryAnalysis['coverageRegressions'] = [];
  const weight = { unsupported: 0, 'not-observed': 1, limited: 2, active: 3 };
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1], b = entries[i];
    const diff = diffTraces(a.trace, b.trace, { leftProcess: a.processId, rightProcess: b.processId });
    const changes: DriftChange[] = [];
    for (const row of diff.rows) {
      const oldSites = new Set(row.left.reads.map(siteLabel)), oldOrigins = new Set(row.left.reads.map(originLabel));
      const newSites = row.right.reads.map(siteLabel).filter(s => !oldSites.has(s));
      const newOrigins = row.right.reads.map(originLabel).filter(s => !oldOrigins.has(s));
      const signature = (e: Parameters<typeof siteLabel>[0]) => `${e?.operation}:${siteLabel(e)}:${originLabel(e)}`;
      const oldMutations = new Set(row.left.writes.map(signature));
      const newMutationSites = row.right.writes.map(signature).filter(s => !oldMutations.has(s));
      const labels = [...row.changes];
      if (newMutationSites.length && !labels.includes('new mutation sites')) labels.push('new mutation sites');
      if (!labels.length) continue;
      if (!first.has(row.key)) first.set(row.key, i);
      changes.push({ key: row.key, changes: labels, newReadSites: [...new Set(newSites)], newOrigins: [...new Set(newOrigins)],
        newMutationSites: [...new Set(newMutationSites)], sourceRun: i - 1, targetRun: i });
    }
    const reasons: string[] = [];
    if (a.trace.capture.status === 'complete' && b.trace.capture.status !== 'complete') reasons.push('Stream completeness regressed.');
    for (const old of a.trace.coverage) {
      const now = b.trace.coverage.find(c => c.feature === old.feature);
      if (!now || weight[now.status] < weight[old.status]) reasons.push(`${old.feature} coverage declaration regressed.`);
    }
    if (b.trace.processes.reduce((n, p) => n + p.eventsDropped, 0) > a.trace.processes.reduce((n, p) => n + p.eventsDropped, 0)) reasons.push('Recorded dropped-event count increased.');
    if (reasons.length) regressions.push({ run: i, reasons });
    transitions.push({ from: i - 1, to: i, sameDomain: diff.sameDomain, complete: diff.completeStreams, coverageChanged: diff.coverageChanged, changes });
  }
  return { schemaVersion: 'configtrace-history/1', ordering, rawValuesAvailable: false,
    runs: entries.map((e, index) => ({ index, label: e.label, traceId: e.trace.id, capture: e.trace.capture.status })), transitions,
    firstDivergence: [...first].map(([key, run]) => ({ key, run, label: entries[run].label })), coverageRegressions: regressions,
    caveats: [
      'First divergence means the first adjacent-run divergence in the supplied ordering, not the first change ever made to the application.',
      'A shared comparison key is required for equality of present values. Origins/sites and presence changes can remain informative without one.',
      'Processes and Workers must be selected explicitly by library callers; CLI directory analysis compares root contexts only.',
      'No backend, secret key, mtime-based chronology, or automatic file deletion is involved.',
    ] };
}
export function readHistory(directory: string, options: { maxRuns?: number; order?: 'filename' | 'started-at' } = {}): HistoryEntry[] {
  const maxRuns = options.maxRuns ?? 30;
  if (!Number.isInteger(maxRuns) || maxRuns < 2 || maxRuns > 100) throw new UserError('--max-runs must be between 2 and 100.');
  let files: string[];
  try {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid directory');
    files = fs.readdirSync(directory).filter(name => name.endsWith('.ct.json')).sort();
  } catch { throw new UserError('History directory is unavailable or is not a regular directory.', 74); }
  if (files.length > maxRuns) throw new UserError('History contains more files than --max-runs. Select a smaller directory or raise the explicit limit.', 65);
  let bytes = 0;
  const entries = files.map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new UserError('History accepts regular, non-symlink .ct.json files only.', 65);
    bytes += stat.size;
    if (bytes > 64 * 1024 * 1024) throw new UserError('History exceeds its 64 MiB aggregate input limit.', 65);
    return { label: name, trace: readTrace(file) };
  });
  if (options.order === 'started-at') {
    const time = (e: HistoryEntry) => Date.parse(e.trace.processes.find(p => p.role === 'root')?.startedAt || '');
    if (entries.some(e => !Number.isFinite(time(e)))) throw new UserError('Timestamp ordering requires a valid root startedAt in every trace. Use filename ordering for sanitized exports.', 65);
    entries.sort((a, b) => time(a) - time(b) || a.label.localeCompare(b.label));
  }
  return entries;
}
export function addHistory(file: string, directory: string): string {
  const trace = readTrace(file);
  const target = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${trace.id}.ct.json`);
  writeTrace(target, trace); return target;
}
export function historyText(result: HistoryAnalysis): string {
  return terminalSafe(['CONFIGPROOF / LOCAL DRIFT', `${result.runs.length} runs · order: ${result.ordering}`,
    ...result.transitions.flatMap(t => [`\n${result.runs[t.from].label} → ${result.runs[t.to].label} (${t.sameDomain ? 'shared value domain' : 'values may be incomparable'})`,
      ...t.changes.map(c => `  ${c.key}: ${c.changes.join(', ')}`)]),
    '\nFirst observed divergence by key:', ...result.firstDivergence.map(d => `  ${d.key}: ${d.label}`),
    ...result.coverageRegressions.flatMap(r => r.reasons.map(reason => `Coverage: ${result.runs[r.run].label}: ${reason}`)),
    ...result.caveats.map(c => `Note: ${c}`)].join('\n'), true) + '\n';
}
