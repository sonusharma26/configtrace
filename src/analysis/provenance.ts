import { createHash } from 'node:crypto';
import type { Trace, Observation, Origin } from '../core/schema';
import { sameValue } from '../core/privacy';
import { processFor, siteLabel } from '../core/analyze';
import { UserError } from '../core/io';

export type EvidenceConfidence = Origin['confidence'];
export type ProvenanceNodeKind = 'process' | 'worker' | 'key' | 'startup' | 'candidate' | 'application' | 'mutation' | 'read' | 'loader' | 'source' | 'read-site' | 'adapter' | 'boundary' | 'unknown';
export type ProvenanceRelation = 'contains' | 'proposed' | 'applied' | 'skipped' | 'overwrote' | 'inherited' | 'read-by' | 'spawned-with' | 'copied-to' | 'shared-with' | 'evidence-linked-to' | 'declared-source';
export interface ProvenanceNode {
  id: string; kind: ProvenanceNodeKind; label: string; processId?: string; key?: string;
  eventId?: string; seq?: number; at?: number; confidence: EvidenceConfidence;
  state?: 'present' | 'missing' | 'omitted'; empty?: boolean;
}
export interface ProvenanceEdge {
  id: string; from: string; to: string; relation: ProvenanceRelation;
  confidence: EvidenceConfidence; evidenceIds: string[];
}
export interface ProvenanceGraph {
  schemaVersion: 'configtrace-provenance/1'; traceId: string; rawValuesAvailable: false;
  nodes: ProvenanceNode[]; edges: ProvenanceEdge[]; truncated: boolean;
  coverage: Trace['coverage']; captureStatus: Trace['capture']['status']; caveats: string[];
}
export interface ProvenanceOptions { key?: string; processId?: string; allProcesses?: boolean; maxNodes?: number; maxEdges?: number }
const identity = (...parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const eventKind = (e: Observation): ProvenanceNodeKind => e.operation === 'baseline' ? 'startup'
  : e.operation === 'candidate' ? 'candidate' : e.operation === 'read' ? 'read'
  : e.operation === 'write' && ['dotenv', 'native-env'].includes(e.origin?.kind || '') ? 'application'
  : ['write', 'delete'].includes(e.operation) ? 'mutation' : e.operation === 'boundary' ? 'boundary' : 'loader';

/** A directed acyclic evidence graph, not a claim of full causal reconstruction. */
export function buildProvenance(trace: Trace, options: ProvenanceOptions = {}): ProvenanceGraph {
  const maxNodes = options.maxNodes ?? 20000, maxEdges = options.maxEdges ?? 60000;
  if (!Number.isInteger(maxNodes) || maxNodes < 10 || maxNodes > 250000 || !Number.isInteger(maxEdges) || maxEdges < 10 || maxEdges > 1000000) throw new UserError('Invalid provenance display limits.');
  const chosen = options.allProcesses ? undefined : processFor(trace, options.processId);
  const contexts = new Map(trace.processes.map(p => [p.id, p]));
  const caseFor = (pid: string) => contexts.get(pid)?.caseMode || trace.capture.caseMode;
  const keyMatches = (e: Observation) => !options.key || e.key === (caseFor(e.processId) === 'insensitive' ? options.key.toUpperCase() : options.key);
  const selected = trace.events.filter(e => (!chosen || e.processId === chosen) && (keyMatches(e) || !e.key && ['child-spawn', 'worker-spawn', 'boundary'].includes(e.operation)));
  const nodes = new Map<string, ProvenanceNode>();
  const edges: ProvenanceEdge[] = [];
  const edgeIds = new Set<string>();
  let truncated = false;
  const add = (node: ProvenanceNode) => {
    if (nodes.has(node.id)) return true;
    if (nodes.size >= maxNodes) { truncated = true; return false; }
    nodes.set(node.id, node); return true;
  };
  const link = (from: string, to: string, relation: ProvenanceRelation, confidence: EvidenceConfidence, evidenceIds: string[] = []) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const id = identity(from, to, relation);
    if (edgeIds.has(id)) return;
    if (edges.length >= maxEdges) { truncated = true; return; }
    edgeIds.add(id); edges.push({ id, from, to, relation, confidence, evidenceIds });
  };
  for (const p of trace.processes) add({ id: `process:${p.id}`, kind: p.role === 'worker' ? 'worker' : 'process', label: `${p.role} ${p.id}`, processId: p.id, confidence: 'observed' });
  const state = new Map<string, Observation>();
  const candidate = new Map<string, Observation>();
  const fileLoads = new Map<string, Observation>();
  for (const e of selected) {
    const eid = `event:${e.id}`, pid = `process:${e.processId}`;
    const slot = JSON.stringify([e.processId, e.key]);
    const confidence = e.origin?.confidence || 'observed';
    if (!add({ id: eid, kind: eventKind(e), label: `${e.operation}${e.key ? ' ' + e.key : e.loaderMethod ? ' ' + e.loaderMethod : ''}`,
      processId: e.processId, key: e.key, eventId: e.id, seq: e.seq, at: e.at, confidence,
      state: e.value?.state, empty: e.value?.state === 'present' ? e.value.empty : undefined })) break;
    link(pid, eid, 'contains', 'observed', [e.id]);
    if (e.key) {
      const kid = `key:${identity(e.processId, e.key)}`;
      add({ id: kid, kind: 'key', label: e.key, processId: e.processId, key: e.key, confidence: 'derived' });
      link(pid, kid, 'contains', 'derived'); link(kid, eid, 'contains', 'derived', [e.id]);
    }
    if (e.origin?.file) {
      const sid = `source:${identity(e.processId, e.origin.kind, e.origin.file)}`;
      add({ id: sid, kind: 'source', label: e.origin.file, processId: e.processId, confidence });
      // Read-origin files are annotations, not direct proof of a new file load at read time.
      if (e.operation !== 'read') link(sid, eid, e.outcome === 'declared' ? 'declared-source' : 'evidence-linked-to', confidence, [e.id]);
      const loaderSlot = JSON.stringify([e.processId, e.origin.kind, e.origin.file]);
      if (e.operation === 'load') fileLoads.set(loaderSlot, e);
      else if (e.operation === 'candidate') {
        const load = fileLoads.get(loaderSlot);
        if (load && load.seq < e.seq) link(`event:${load.id}`, eid, 'proposed', 'inferred', [load.id, e.id]);
      }
    }
    if (e.origin?.adapterId) {
      const aid = `adapter:${identity(e.processId, e.origin.adapterId)}`;
      add({ id: aid, kind: 'adapter', label: e.origin.adapterId, processId: e.processId, confidence });
      link(aid, eid, 'evidence-linked-to', confidence, [e.id]);
    }
    if (e.operation === 'baseline') {
      const unknown = `unknown-before:${e.id}`;
      add({ id: unknown, kind: 'unknown', label: 'Before preload: provenance unavailable', processId: e.processId, key: e.key, confidence: 'unknown' });
      link(unknown, eid, 'inherited', 'unknown', [e.id]);
    }
    if (e.operation === 'candidate') candidate.set(slot, e);
    if (e.operation === 'skip' || e.operation === 'write') {
      const prior = candidate.get(slot);
      const compared = e.operation === 'skip' ? e.candidate : e.value;
      if (prior && sameValue(prior.value, compared) && prior.origin?.kind === e.origin?.kind && prior.origin?.file === e.origin?.file) {
        link(`event:${prior.id}`, eid, e.operation === 'skip' ? 'skipped' : 'applied', 'inferred', [prior.id, e.id]);
      }
    }
    if (['write', 'delete'].includes(e.operation)) {
      const prior = state.get(slot);
      if (prior && prior.value?.state === 'present' && !sameValue(prior.value, e.value)) link(`event:${prior.id}`, eid, 'overwrote', 'derived', [prior.id, e.id]);
    }
    if (e.causedBy) link(`event:${e.causedBy}`, eid, 'evidence-linked-to', 'inferred', [e.causedBy, e.id]);
    if (e.operation === 'read') {
      if (!e.causedBy || e.origin?.kind === 'unknown') {
        const uid = `unknown:${e.id}`;
        add({ id: uid, kind: 'unknown', label: 'Prior origin unavailable', processId: e.processId, key: e.key, confidence: 'unknown' });
        link(uid, eid, 'evidence-linked-to', 'unknown', [e.id]);
      }
      if (e.site) {
        // Read sites are sinks distinct from source-file nodes: no synthetic file cycles.
        const sid = `read-site:${identity(e.processId, siteLabel(e))}`;
        add({ id: sid, kind: 'read-site', label: siteLabel(e), processId: e.processId, confidence: 'observed' });
        link(eid, sid, 'read-by', 'observed', [e.id]);
      }
    }
    if (['baseline', 'write', 'delete'].includes(e.operation)) state.set(slot, e);
    if (['child-spawn', 'worker-spawn'].includes(e.operation) && e.childId && e.outcome === 'spawned') {
      const relation: ProvenanceRelation = e.environmentMode === 'shared' ? 'shared-with' : e.environmentMode === 'copied' ? 'copied-to' : 'spawned-with';
      const child = contexts.get(e.childId);
      // Only a confirmed child of this context can receive a creation edge.
      if (child?.parentId === e.processId && child.role === (e.operation === 'worker-spawn' ? 'worker' : 'child'))
        link(eid, `process:${e.childId}`, relation, 'observed', [e.id]);
    }
  }
  return { schemaVersion: 'configtrace-provenance/1', traceId: trace.id, rawValuesAvailable: false,
    nodes: [...nodes.values()], edges, truncated, coverage: trace.coverage, captureStatus: trace.capture.status,
    caveats: [
      'Observed nodes and inferred causal links are different claims. Matching fingerprints do not rule out unobserved mutations.',
      'The graph is ordered per execution context. Timestamps from different processes or Workers are not a shared causal clock.',
      'Startup presence does not identify a shell or an early env file. A declared startup flag is only a source hint.',
      'A SHARE_ENV relationship does not identify which concurrent write supplied another thread\'s read.',
      ...(truncated ? ['Graph limits were reached. Some nodes or links are omitted; use a key/process filter.'] : []),
    ] };
}
