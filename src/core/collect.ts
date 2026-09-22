import fs from 'node:fs';
import path from 'node:path';
import { StreamRecordSchema, SCHEMA_VERSION, TOOL_VERSION, MAX_ARTIFACT_BYTES, MAX_EVENTS, MAX_PROCESSES,
  type Trace, type Notice, type Coverage, type ProcessInfo, type Observation } from './schema';
import { readBounded } from './io';
import type { RuntimeConfig } from '../runtime/api';

export function coverageFor(notices: Notice[]): Coverage[] {
  const has = (n: Notice) => notices.includes(n);
  return [
    { feature: 'environment', status: 'limited', reasons: ['original_reference_bypass', ...(has('environment_replaced') ? ['environment_replaced' as const] : [])] },
    { feature: 'startup', status: 'limited', reasons: ['startup_history_unknown', 'early_preloads_possible'] },
    { feature: 'dotenv', status: has('dotenv_attached') ? 'limited' : 'not-observed', reasons: notices.filter(n => n.startsWith('dotenv_')) },
    { feature: 'source-maps', status: has('source_maps_requested') ? 'limited' : 'not-observed', reasons: [has('source_maps_requested') ? 'source_maps_requested' : 'source_maps_opt_in'] },
    { feature: 'children', status: has('children_opt_in') ? 'limited' : 'unsupported', reasons: notices.filter(n => n.startsWith('child') || n === 'sync_children_unobserved') },
    { feature: 'native', status: 'unsupported', reasons: ['native_access_unobserved'] },
    { feature: 'workers', status: 'unsupported', reasons: ['workers_unsupported'] },
    { feature: 'adapters', status: has('custom_adapter_loaded') ? 'limited' : 'not-observed', reasons: notices.filter(n => n === 'custom_adapter_loaded' || n === 'adapter_failed') },
  ];
}

/** Recover complete records without pretending that interrupted/malformed tails are complete. */
export function collectTrace(config: RuntimeConfig, result: Trace['result']): Trace {
  const notices = new Set<Notice>(['capture_unverified']);
  const processes: ProcessInfo[] = [];
  const events: Observation[] = [];
  let aggregate = 0;
  let files: string[] = [];
  try { files = fs.readdirSync(config.directory).filter(name => /^p_[a-f0-9]{24}\.jsonl$/.test(name)); }
  catch { notices.add('recorder_failed'); }
  files.sort((a, b) => a.startsWith(config.rootId) ? -1 : b.startsWith(config.rootId) ? 1 : a.localeCompare(b));
  if (files.length > MAX_PROCESSES) notices.add('process_limit');
  for (const file of files.slice(0, MAX_PROCESSES)) {
    let raw: string;
    try { raw = readBounded(path.join(config.directory, file), config.maxBytes); }
    catch { notices.add('invalid_stream'); continue; }
    aggregate += Buffer.byteLength(raw);
    if (aggregate > MAX_ARTIFACT_BYTES / 2) { notices.add('aggregate_limit'); break; }
    let info: ProcessInfo | undefined;
    let ended = false;
    let sequence = -1;
    const seen = new Map<string, Observation>();
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const record = StreamRecordSchema.parse(JSON.parse(line));
        if (ended) { notices.add('invalid_stream'); break; }
        if (record.type === 'start') {
          if (info || record.process.id + '.jsonl' !== file) { notices.add('invalid_stream'); break; }
          info = { ...record.process, ended: false, exitCode: null };
          processes.push(info);
        } else if (!info) { notices.add('invalid_stream'); break; }
        else if (record.type === 'notice') notices.add(record.notice);
        else if (record.type === 'end') {
          info.ended = true; info.exitCode = record.exitCode; info.eventsDropped = record.eventsDropped; ended = true;
          if (record.eventsDropped) notices.add('events_dropped');
        } else {
          const e = record.event;
          if (e.processId !== info.id || e.id !== `${info.id}:${e.seq}` || e.seq <= sequence || seen.has(e.id)) { notices.add('invalid_stream'); break; }
          sequence = e.seq;
          if (events.length >= MAX_EVENTS) { notices.add('aggregate_limit'); continue; }
          if (e.causedBy && (!seen.has(e.causedBy) || seen.get(e.causedBy)?.key !== e.key)) {
            delete e.causedBy; e.origin = { kind: 'unknown', confidence: 'unknown' }; notices.add('invalid_stream');
          }
          seen.set(e.id, e);
          events.push(e);
        }
      } catch { notices.add('invalid_stream'); break; }
    }
    if (!ended) notices.add('missing_footer');
  }
  const ids = new Set(processes.map(p => p.id));
  for (const e of events) if (e.operation === 'child-spawn' && e.outcome === 'spawned' && e.childId && !ids.has(e.childId)) notices.add('missing_footer');
  if (processes.some(p => p.role === 'child' && !p.ended)) notices.add('child_outlived_root');
  const partialReasons: Notice[] = ['events_dropped', 'event_limit', 'byte_limit', 'key_limit', 'recorder_failed', 'missing_footer', 'invalid_stream', 'process_limit', 'aggregate_limit', 'child_outlived_root', 'environment_replaced', 'adapter_failed'];
  const rootFound = processes.some(p => p.id === config.rootId);
  const status = !rootFound ? 'failed' : partialReasons.some(n => notices.has(n)) ? 'partial' : 'complete';
  return {
    schemaVersion: SCHEMA_VERSION, toolVersion: TOOL_VERSION, id: config.runId,
    comparison: { domainId: config.comparison.domainId, mode: 'hmac-sha256' },
    capture: { status, watch: config.watch, caseMode: process.platform === 'win32' ? 'insensitive' : 'sensitive', maxEventsPerProcess: config.maxEvents, notices: [...notices] },
    result, processes, events, coverage: coverageFor([...notices]), exported: false,
  };
}
