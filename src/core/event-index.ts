import type { Trace, Observation, ProcessInfo } from './schema';
import { UserError } from './io';
import { BoundedCache } from './cache';

export interface KeyEvidence {
  key: string; processId?: string; baseline?: Observation;
  reads: Observation[]; loaderReads: number; writes: Observation[]; candidates: Observation[]; skips: Observation[];
  events: Observation[]; lastRead?: Observation;
}
export interface EvidenceSummary {
  readSites: string[]; readOrigins: string[]; loaders: string[]; mutations: string[];
}
interface ProcessEvidence {
  events: Observation[];
  keys: Map<string, KeyEvidence>;
}
function emptyEvidence(key: string, processId?: string): KeyEvidence {
  return { key, processId, events: [], baseline: undefined, reads: [], loaderReads: 0,
    writes: [], candidates: [], skips: [], lastRead: undefined };
}
export function rawSiteLabel(e?: Observation): string {
  return e?.site ? `${e.site.file}${e.site.line ? ':' + e.site.line : ''}${e.site.column ? ':' + e.site.column : ''}` : '<call site unavailable>';
}
export function rawOriginLabel(e?: Observation): string {
  return e?.origin ? `${e.origin.kind}${e.origin.file ? ' (' + e.origin.file + ')' : ''} / ${e.origin.confidence}` : 'unknown';
}

/**
 * Explicit analysis-lifetime index. Events are referenced, never cloned or serialized.
 * No global memoization: create a new index after changing a trace (including metadata).
 * Treat returned evidence and events as read-only while an index is in use.
 */
export class TraceIndex {
  private readonly processes: Map<string, ProcessInfo>;
  private readonly contexts = new Map<string, ProcessEvidence>();
  private readonly interned = new BoundedCache<string, string>(4096);
  private readonly summaries = new Map<KeyEvidence, EvidenceSummary>();
  private summaryReferences = 0;
  private readonly summaryReferenceLimit = 32_768;
  readonly eventsVisited: number;
  constructor(readonly trace: Trace) {
    this.processes = new Map(trace.processes.map(p => [p.id, p]));
    for (const event of trace.events) {
      let context = this.contexts.get(event.processId);
      if (!context) { context = { events: [], keys: new Map() }; this.contexts.set(event.processId, context); }
      context.events.push(event);
      if (event.key === undefined) continue;
      let evidence = context.keys.get(event.key);
      if (!evidence) { evidence = emptyEvidence(event.key, event.processId); context.keys.set(event.key, evidence); }
      evidence.events.push(event);
      switch (event.operation) {
        case 'baseline': evidence.baseline ??= event; break;
        case 'read':
          if (event.purpose === 'loader') evidence.loaderReads++;
          else { evidence.reads.push(event); evidence.lastRead = event; }
          break;
        case 'write': case 'delete': evidence.writes.push(event); break;
        case 'candidate': evidence.candidates.push(event); break;
        case 'skip': evidence.skips.push(event); break;
      }
    }
    this.eventsVisited = trace.events.length;
  }
  assertTrace(trace: Trace): this {
    if (this.trace !== trace) throw new UserError('An event index belongs to a different trace.', 65);
    return this;
  }
  processFor(requested?: string): string | undefined {
    if (requested) {
      if (!this.processes.has(requested)) throw new UserError('Selected process does not exist in this artifact.', 65);
      return requested;
    }
    return this.trace.processes.find(p => p.role === 'root')?.id;
  }
  info(processId?: string): ProcessInfo | undefined { return processId ? this.processes.get(processId) : undefined; }
  caseMode(processId?: string): Trace['capture']['caseMode'] { return this.info(processId)?.caseMode || this.trace.capture.caseMode; }
  events(processId?: string): Observation[] { return processId ? this.contexts.get(processId)?.events || [] : []; }
  keys(processId?: string): string[] {
    const insensitive = this.caseMode(processId) === 'insensitive';
    const literals = this.trace.capture.watch.filter(k => !/[*?]/.test(k)).map(k => insensitive ? k.toUpperCase() : k);
    const observed = processId ? this.contexts.get(processId)?.keys.keys() || [] : [];
    return [...new Set([...literals, ...observed])];
  }
  evidence(key: string, processId?: string): KeyEvidence {
    key = this.caseMode(processId) === 'insensitive' ? key.toUpperCase() : key;
    return (processId ? this.contexts.get(processId)?.keys.get(key) : undefined) || emptyEvidence(key, processId);
  }
  private intern(value: string): string {
    const previous = this.interned.get(value);
    if (previous !== undefined) return previous;
    this.interned.set(value, value); return value;
  }
  site(event?: Observation): string { return this.intern(rawSiteLabel(event)); }
  origin(event?: Observation): string { return this.intern(rawOriginLabel(event)); }
  summary(evidence: KeyEvidence): EvidenceSummary {
    let summary = this.summaries.get(evidence);
    if (summary) return summary;
    summary = { readSites: [], readOrigins: [], loaders: [], mutations: [] };
    // Arrays retain references to interned strings, not one label-object per event.
    for (const event of evidence.reads) {
      summary.readSites.push(this.site(event)); summary.readOrigins.push(this.origin(event));
    }
    for (const event of evidence.events) {
      if (event.operation === 'skip' || event.operation === 'write' && ['dotenv', 'native-env'].includes(event.origin?.kind || ''))
        summary.loaders.push(this.intern(`${event.operation}:${event.outcome ?? ''}:${this.origin(event)}`));
    }
    for (const event of evidence.writes)
      summary.mutations.push(this.intern(`${event.operation}:${this.site(event)}:${this.origin(event)}`));
    const cost = (s: EvidenceSummary) => s.readSites.length + s.readOrigins.length + s.loaders.length + s.mutations.length;
    const references = cost(summary);
    // Bound retained derived arrays as well as their strings. Large keys are computed
    // on demand, not permanently cached; raw evidence remains complete and indexed.
    // Admit while budget remains, rather than FIFO-evicting earlier groups. A
    // diff followed by diagnosis visits keys in the same order: FIFO eviction
    // would thrash and recompute every summary whenever the working set exceeds
    // the cache. Uncached groups still return complete freshly-derived evidence.
    if (this.summaryReferences + references <= this.summaryReferenceLimit && this.summaries.size < 64) {
      this.summaryReferences += references; this.summaries.set(evidence, summary);
    }
    return summary;
  }
}
export function buildTraceIndex(trace: Trace): TraceIndex { return new TraceIndex(trace); }
export interface ComparisonIndexes { leftIndex?: TraceIndex; rightIndex?: TraceIndex }
