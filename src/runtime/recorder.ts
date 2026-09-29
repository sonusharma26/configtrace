import fs from 'node:fs';
import path from 'node:path';
import { WatchSet, PathScrubber, fingerprint, sameValue } from '../core/privacy';
import { AdapterManifestSchema, type AdapterManifest, type Observation, type Origin, type SafeValue, type Notice, type ProcessInfo, type StreamRecord } from '../core/schema';
import { captureSite } from './callsite';
import type { RuntimeConfig } from './api';

type ValueOperation = 'baseline' | 'read' | 'write' | 'delete' | 'candidate' | 'skip';
interface RecordOptions {
  before?: string;
  hasBefore?: boolean;
  candidate?: string;
  hasCandidate?: boolean;
  origin?: Origin;
  outcome?: Observation['outcome'];
  site?: Observation['site'];
}
interface State { value: SafeValue; eventId: string; origin: Origin }

class StreamWriter {
  private readonly fd: number;
  private bytes = 0;
  private closed = false;
  failed = false;
  constructor(file: string, private readonly maxBytes: number) { this.fd = fs.openSync(file, 'wx', 0o600); }
  write(record: StreamRecord, reserved = false): boolean {
    if (this.closed || this.failed) return false;
    try {
      const data = Buffer.from(JSON.stringify(record) + '\n');
      if (!reserved && this.bytes + data.length > this.maxBytes - 8192) return false;
      if (this.bytes + data.length > this.maxBytes) return false;
      let offset = 0;
      while (offset < data.length) {
        const n = fs.writeSync(this.fd, data, offset, data.length - offset);
        if (n <= 0) throw new Error('Recorder write failed');
        offset += n;
      }
      this.bytes += data.length;
      return true;
    } catch { this.failed = true; return false; }
  }
  close(): void {
    if (!this.closed) { this.closed = true; try { fs.closeSync(this.fd); } catch { this.failed = true; } }
  }
}

export class Recorder {
  readonly watch: WatchSet;
  readonly paths: PathScrubber;
  readonly process: ProcessInfo;
  private readonly writer: StreamWriter;
  private readonly start = process.hrtime.bigint();
  private readonly states = new Map<string, State>();
  private readonly keys = new Set<string>();
  private readonly notices = new Set<Notice>();
  private readonly origins: Array<(key: string) => Origin> = [];
  private seq = 0;
  private count = 0;
  private dropped = 0;
  private depth = 0;
  private stopped = false;
  private adapterIds = new Set<string>();
  sharedEnvironment = false;

  constructor(readonly config: RuntimeConfig, instanceId: string, parentId?: string, worker?: { threadId: number; environmentMode: ProcessInfo['environmentMode'] }) {
    this.watch = new WatchSet(config.watch, process.platform === 'win32' && !worker);
    this.paths = new PathScrubber(config.root, config.comparison.secret);
    this.process = {
      id: instanceId, parentId, role: worker ? 'worker' : parentId ? 'child' : 'root',
      threadId: worker?.threadId, environmentMode: worker?.environmentMode,
      caseMode: this.watch.insensitive ? 'insensitive' : 'sensitive',
      pid: process.pid, ppid: process.ppid, node: process.version, platform: process.platform,
      entry: this.paths.scrub(process.argv[1] || '<eval>'), startedAt: new Date().toISOString(),
      ended: false, exitCode: null, eventsDropped: 0,
    };
    this.sharedEnvironment = worker?.environmentMode === 'shared';
    this.writer = new StreamWriter(path.join(config.directory, `${instanceId}.jsonl`), config.maxBytes);
    this.writer.write({ type: 'start', process: this.process }, true);
  }
  get suppressed(): boolean { return this.depth > 0 || this.stopped; }
  suppress<T>(action: () => T): T { this.depth++; try { return action(); } finally { this.depth--; } }
  withOrigin<T>(origin: Origin | ((key: string) => Origin), action: () => T): T {
    this.origins.push(typeof origin === 'function' ? origin : () => origin);
    try { return action(); } finally { this.origins.pop(); }
  }
  currentOrigin(key: string): Origin | undefined { return this.origins.at(-1)?.(key); }
  token(key: string, value: string | undefined): SafeValue {
    return fingerprint(this.config.comparison, this.watch.canonical(key), value);
  }
  site(): Observation['site'] { return this.suppress(() => captureSite(this.paths, this.config.sourceMaps)); }
  latestId(key: string): string | undefined { return this.states.get(this.watch.canonical(key))?.eventId; }
  notice(notice: Notice): void {
    if (notice === 'worker_shared_env') this.sharedEnvironment = true;
    if (this.notices.has(notice) || this.stopped) return;
    this.notices.add(notice);
    this.suppress(() => this.writer.write({ type: 'notice', notice }, true));
  }
  private emit(event: Omit<Observation, 'id' | 'processId' | 'seq' | 'at'>): Observation | undefined {
    if (this.stopped) return;
    if (this.count >= this.config.maxEvents) { this.dropped++; this.notice('event_limit'); return; }
    const seq = this.seq++;
    const full: Observation = { ...event, id: `${this.process.id}:${seq}`, processId: this.process.id, seq, at: Number(process.hrtime.bigint() - this.start) / 1e6 };
    if (!this.writer.write({ type: 'event', event: full })) {
      this.dropped++;
      this.notice(this.writer.failed ? 'recorder_failed' : 'byte_limit');
      return;
    }
    this.count++;
    return full;
  }

  /** Instrumentation failures are contained; the original operation has already run. */
  observe(operation: ValueOperation, key: string, raw: string | undefined, options: RecordOptions = {}): Observation | undefined {
    if (this.suppressed || !this.watch.matches(key)) return;
    return this.suppress(() => {
      try {
        key = this.watch.canonical(key);
        if (!this.keys.has(key) && this.keys.size >= 256) { this.dropped++; this.notice('key_limit'); return; }
        this.keys.add(key);
        const value = this.token(key, raw);
        const previous = this.states.get(key);
        let origin = options.origin ?? this.currentOrigin(key);
        let causedBy: string | undefined;
        if (operation === 'read') {
          if (previous && sameValue(previous.value, value)) {
            causedBy = previous.eventId;
            origin = { ...previous.origin, confidence: 'inferred' };
          } else origin = { kind: 'unknown', confidence: 'unknown' };
        }
        if (!origin) origin = { kind: operation === 'baseline' ? 'startup' : 'runtime', confidence: 'observed' };
        if (origin.file) origin = { ...origin, file: this.paths.scrub(origin.file) };
        const event = this.emit({
          key, operation, value, origin, causedBy,
          before: options.hasBefore ? this.token(key, options.before) : undefined,
          candidate: options.hasCandidate ? this.token(key, options.candidate) : undefined,
          outcome: options.outcome,
          purpose: this.origins.length ? 'loader' : 'application',
          site: operation === 'baseline' ? undefined : options.site ?? captureSite(this.paths, this.config.sourceMaps),
        });
        if (event && ['baseline', 'write', 'delete'].includes(operation)) this.states.set(key, { value, eventId: event.id, origin });
        return event;
      } catch { this.notice('recorder_failed'); return; }
    });
  }
  declareAdapter(manifest: AdapterManifest, installedVersion?: string): void {
    try {
      const checked = AdapterManifestSchema.parse(manifest);
      if (this.adapterIds.has(checked.id) || this.adapterIds.size >= 8) return;
      this.adapterIds.add(checked.id);
      const written = this.suppress(() => this.writer.write({ type: 'adapter', declaration: {
        processId: this.process.id, manifest: checked,
        installedVersion: installedVersion?.slice(0, 80), validation: 'unverified',
      } }, true));
      if (!written) { this.dropped++; this.notice(this.writer.failed ? 'recorder_failed' : 'byte_limit'); }
    } catch { this.notice('adapter_failed'); }
  }
  loader(file: string | undefined, outcome: 'read-success' | 'read-failed' | 'declared',
    options: { kind?: 'dotenv' | 'native-env'; phase?: 'startup' | 'runtime'; method?: Observation['loaderMethod']; confidence?: Origin['confidence'] } = {}): void {
    try {
      this.suppress(() => this.emit({ operation: 'load', origin: {
        kind: options.kind || 'dotenv', confidence: options.confidence || (file ? 'observed' : 'unknown'),
        file: file ? this.paths.scrub(file) : undefined,
      }, outcome, purpose: 'loader', phase: options.phase, loaderMethod: options.method }));
    } catch { this.notice('recorder_failed'); }
  }
  child(childId: string, outcome: 'spawned' | 'spawn-failed'): void {
    try { this.suppress(() => this.emit({ operation: 'child-spawn', childId, outcome, site: captureSite(this.paths, this.config.sourceMaps) })); }
    catch { this.notice('recorder_failed'); }
  }
  worker(childId: string, outcome: 'spawned' | 'spawn-failed', environmentMode: Observation['environmentMode']): void {
    try { this.suppress(() => this.emit({ operation: 'worker-spawn', childId, outcome, environmentMode, site: captureSite(this.paths, this.config.sourceMaps) })); }
    catch { this.notice('recorder_failed'); }
  }
  boundary(kind: 'manual' | 'uncaught-exception'): Observation | undefined {
    try {
      this.notice('failure_boundary_recorded');
      return this.suppress(() => this.emit({ operation: 'boundary', boundaryKind: kind, site: captureSite(this.paths, this.config.sourceMaps) }));
    } catch { this.notice('recorder_failed'); return undefined; }
  }
  finish(exitCode: number): void {
    if (this.stopped) return;
    this.suppress(() => {
      this.writer.write({ type: 'end', exitCode, eventsDropped: this.dropped }, true);
      this.writer.close();
    });
    this.stopped = true;
  }
}
