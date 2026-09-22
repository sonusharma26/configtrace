import type { Trace, Observation, SafeValue } from './schema';
import { sameValue } from './privacy';
import { UserError, terminalSafe } from './io';

export type Equality = 'same' | 'different' | 'incomparable' | 'not-observed';
export interface KeyEvidence {
  key: string; processId?: string; baseline?: Observation;
  reads: Observation[]; loaderReads: number; writes: Observation[]; candidates: Observation[]; skips: Observation[];
  events: Observation[]; lastRead?: Observation;
}
export interface DiffRow {
  key: string; left: KeyEvidence; right: KeyEvidence;
  startup: Equality; lastRead: Equality; readSequence: Equality;
  changes: string[];
}
export interface TraceDiff {
  schemaVersion: 'configtrace-diff/1'; sameDomain: boolean; coverageChanged: boolean;
  leftProcess?: string; rightProcess?: string; completeStreams: boolean;
  rows: DiffRow[]; changed: boolean; caveats: string[];
}

export function processFor(trace: Trace, requested?: string): string | undefined {
  if (requested) {
    if (!trace.processes.some(p => p.id === requested)) throw new UserError('Selected process does not exist in this artifact.', 65);
    return requested;
  }
  return trace.processes.find(p => p.role === 'root')?.id;
}
export function evidenceFor(trace: Trace, key: string, requested?: string): KeyEvidence {
  const processId = processFor(trace, requested);
  key = trace.capture.caseMode === 'insensitive' ? key.toUpperCase() : key;
  const events = trace.events.filter(e => e.processId === processId && e.key === key);
  const reads = events.filter(e => e.operation === 'read' && e.purpose !== 'loader');
  return { key, processId, events, baseline: events.find(e => e.operation === 'baseline'), reads,
    loaderReads: events.filter(e => e.operation === 'read' && e.purpose === 'loader').length,
    writes: events.filter(e => e.operation === 'write' || e.operation === 'delete'),
    candidates: events.filter(e => e.operation === 'candidate'), skips: events.filter(e => e.operation === 'skip'), lastRead: reads.at(-1) };
}
export function compareValue(a: SafeValue | undefined, b: SafeValue | undefined, sharedDomain: boolean): Equality {
  if (!a || !b) return 'not-observed';
  if (a.state === 'omitted' || b.state === 'omitted') return 'incomparable';
  if (a.state !== b.state) return 'different';
  if (a.state === 'missing' && b.state === 'missing') return 'same';
  if (!sharedDomain) return 'incomparable';
  return sameValue(a, b) ? 'same' : 'different';
}
export function siteLabel(e?: Observation): string {
  return e?.site ? `${e.site.file}${e.site.line ? ':' + e.site.line : ''}${e.site.column ? ':' + e.site.column : ''}` : '<call site unavailable>';
}
export function originLabel(e?: Observation): string {
  return e?.origin ? `${e.origin.kind}${e.origin.file ? ' (' + e.origin.file + ')' : ''} / ${e.origin.confidence}` : 'unknown';
}
export function valueLabel(v?: SafeValue): string {
  return !v ? 'not observed' : v.state === 'missing' ? 'missing' : v.state === 'omitted' ? 'withheld' : 'present · masked';
}
function keysFor(trace: Trace, processId?: string): string[] {
  const literalWatch = trace.capture.watch.filter(k => !/[*?]/.test(k))
    .map(k => trace.capture.caseMode === 'insensitive' ? k.toUpperCase() : k);
  return [...new Set([...literalWatch, ...trace.events.filter(e => e.processId === processId && e.key).map(e => e.key!)])];
}
function equalLists(a: string[], b: string[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export function diffTraces(left: Trace, right: Trace, options: { leftProcess?: string; rightProcess?: string } = {}): TraceDiff {
  const leftProcess = processFor(left, options.leftProcess);
  const rightProcess = processFor(right, options.rightProcess);
  const sameDomain = left.comparison.mode !== 'none' && left.comparison.mode === right.comparison.mode && left.comparison.domainId === right.comparison.domainId;
  const coverageChanged = JSON.stringify(left.coverage) !== JSON.stringify(right.coverage)
    || left.capture.status !== right.capture.status || left.capture.caseMode !== right.capture.caseMode
    || !equalLists([...left.capture.watch].sort(), [...right.capture.watch].sort());
  const keys = [...new Set([...keysFor(left, leftProcess), ...keysFor(right, rightProcess)])].sort();
  const rows: DiffRow[] = keys.map(key => {
    const a = evidenceFor(left, key, leftProcess), b = evidenceFor(right, key, rightProcess);
    const startup = compareValue(a.baseline?.value, b.baseline?.value, sameDomain);
    const lastRead = compareValue(a.lastRead?.value, b.lastRead?.value, sameDomain);
    let readSequence: Equality = !a.reads.length && !b.reads.length ? 'not-observed' : 'same';
    if (a.reads.length !== b.reads.length) readSequence = 'different';
    else for (let i = 0; i < a.reads.length; i++) {
      const equality = compareValue(a.reads[i].value, b.reads[i].value, sameDomain);
      if (equality === 'different' || siteLabel(a.reads[i]) !== siteLabel(b.reads[i])) { readSequence = 'different'; break; }
      if (equality !== 'same') readSequence = equality;
    }
    const changes: string[] = [];
    if (startup === 'different') changes.push('startup state/value');
    if (lastRead === 'different') changes.push('last observed read');
    if (readSequence === 'different') changes.push('read sequence');
    if (a.reads.length !== b.reads.length) changes.push('read count');
    if (!equalLists(a.reads.map(siteLabel), b.reads.map(siteLabel))) changes.push('read sites');
    if (!equalLists(a.reads.map(originLabel), b.reads.map(originLabel))) changes.push('read origins');
    const loaderSignature = (e: KeyEvidence) => e.events.filter(x => x.operation === 'skip' || x.operation === 'write' && x.origin?.kind === 'dotenv')
      .map(x => `${x.operation}:${x.outcome ?? ''}:${originLabel(x)}`);
    if (!equalLists(loaderSignature(a), loaderSignature(b))) changes.push('loader outcomes');
    return { key, left: a, right: b, startup, lastRead, readSequence, changes };
  });
  const caveats = [
    'Comparison covers the selected processes and captured operations only. Missing reads do not prove a key was unused.',
    'Read sequences are compared by order and call site; they are not a causal alignment of concurrent activity.',
  ];
  if (!sameDomain) caveats.push('The runs do not share a comparison domain. Equality of present masked values is unknown; presence/absence remains observable.');
  if (coverageChanged) caveats.push('Coverage, watch selection, case handling, or capture status differs. An absent event may be a coverage difference.');
  if (left.capture.status !== 'complete' || right.capture.status !== 'complete') caveats.push('At least one capture is incomplete. Do not interpret a missing change as proof of equivalence.');
  if (left.processes.length > 1 || right.processes.length > 1) caveats.push('Child processes are not automatically matched. Select each child explicitly to compare it.');
  return { schemaVersion: 'configtrace-diff/1', sameDomain, coverageChanged, leftProcess, rightProcess,
    completeStreams: left.capture.status === 'complete' && right.capture.status === 'complete', rows, changed: rows.some(r => r.changes.length > 0), caveats };
}

export function explainText(trace: Trace, key: string, processId?: string): string {
  const e = evidenceFor(trace, key, processId);
  const lines = [key, '='.repeat(Math.min(key.length, 80)),
    `Process: ${e.processId || 'not captured'}`, `Capture: ${trace.capture.status} (stream completeness, not universal coverage)`,
    `At preload: ${valueLabel(e.baseline?.value)}`, `Captured application reads: ${e.reads.length}; loader reads: ${e.loaderReads}`];
  if (!e.reads.length) lines.push('No application read was observed in this selected process. The key may have been used outside coverage.');
  else {
    const last = e.lastRead!;
    lines.push(`Last read: ${siteLabel(last)}`, `Read value: ${valueLabel(last.value)}`, `Evidence-linked source: ${originLabel(last)}`);
    if (last.causedBy) lines.push(`Matching prior observation: ${last.causedBy} (inferred link; bypasses remain possible)`);
    if (last.origin?.kind === 'startup') lines.push(last.value?.state === 'missing'
      ? 'The key was missing at preload and this read matches that observation; unobserved history remains unknown.'
      : 'The value was present at preload. A shell, earlier preload, Node startup option, or native operation may have supplied it; earlier history is unknown.');
    if (last.origin?.kind === 'unknown') lines.push('No matching captured write/baseline establishes this value. Do not guess its origin.');
  }
  if (e.skips.length) lines.push(`dotenv: ${e.skips.length} candidate(s) were not applied to the watched environment in a supported populate call.`);
  lines.push('', 'Evidence (process-local order):');
  for (const event of e.events.slice(0, 120)) lines.push(`  #${event.seq} +${event.at.toFixed(3)}ms ${event.operation.padEnd(9)} ${valueLabel(event.value)} | ${originLabel(event)} | ${siteLabel(event)}`);
  if (e.events.length > 120) lines.push(`  … ${e.events.length - 120} more event(s) retained in the JSON artifact.`);
  lines.push('', 'Limits: native reads, original-object references, Workers, earlier startup history, and late exit-handler reads are not fully observed.');
  return terminalSafe(lines.join('\n'), true) + '\n';
}
export function diffText(diff: TraceDiff): string {
  const lines = [`CONFIGTRACE / RUN COMPARISON`, `Value domain: ${diff.sameDomain ? 'shared' : 'unrelated — present values incomparable'}`,
    `Processes: ${diff.leftProcess || 'missing'} → ${diff.rightProcess || 'missing'}`, ''];
  for (const row of diff.rows) {
    lines.push(row.key, `  startup: ${row.startup}; last read: ${row.lastRead}; read sequence: ${row.readSequence}`,
      `  reads: ${row.left.reads.length} → ${row.right.reads.length}; dotenv candidates not applied: ${row.left.skips.length} → ${row.right.skips.length}`,
      `  origins: ${originLabel(row.left.lastRead)} → ${originLabel(row.right.lastRead)}`,
      `  differences: ${row.changes.length ? row.changes.join(', ') : 'none established within the observations'}`, '');
  }
  lines.push('Caveats:', ...diff.caveats.map(x => `  ${x}`));
  return terminalSafe(lines.join('\n'), true) + '\n';
}
