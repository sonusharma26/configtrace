import { z } from 'zod';

export const TOOL_VERSION = '0.3.1';
export const SCHEMA_VERSION = 'configtrace/2';
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const MAX_EVENTS = 100_000;
export const MAX_PROCESSES = 64;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = z.string().max(512);
const token = z.string().regex(/^[a-f0-9]{64}$/);
export const ValueSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('present'), token, empty: z.boolean().optional() }).strict(),
  z.object({ state: z.literal('missing') }).strict(),
  z.object({ state: z.literal('omitted') }).strict(),
]);
export type SafeValue = z.infer<typeof ValueSchema>;

export const SiteSchema = z.object({
  file: text, line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  mapping: z.enum(['source-map', 'generated', 'unavailable']),
}).strict();
export type CallSite = z.infer<typeof SiteSchema>;
export const OriginSchema = z.object({
  kind: z.enum(['startup', 'runtime', 'dotenv', 'native-env', 'adapter', 'unknown']),
  confidence: z.enum(['observed', 'derived', 'inferred', 'unknown']),
  file: text.optional(), adapterId: id.optional(),
}).strict();
export type Origin = z.infer<typeof OriginSchema>;

export const NoticeSchema = z.enum([
  'startup_history_unknown', 'native_access_unobserved', 'workers_unsupported',
  'original_reference_bypass', 'environment_replaced', 'early_preloads_possible',
  'events_dropped', 'event_limit', 'byte_limit', 'key_limit', 'recorder_failed', 'missing_footer',
  'invalid_stream', 'process_limit', 'aggregate_limit', 'child_outlived_root',
  'children_disabled', 'children_opt_in', 'child_depth_limit', 'child_count_limit',
  'child_shape_unsupported', 'child_shell_or_non_node', 'child_detached',
  'sync_children_unobserved', 'dotenv_not_seen', 'dotenv_attached',
  'dotenv_version_unverified', 'dotenv_custom_target', 'dotenv_source_unknown',
  'dotenv_options_unsupported', 'dotenv_eager_load', 'adapter_failed',
  'source_maps_opt_in', 'source_maps_requested', 'source_map_unavailable',
  'custom_adapter_loaded', 'capture_unverified', 'metadata_scrubbed',
  'comparison_removed', 'loader_details_removed', 'call_sites_removed',
  'native_env_attached', 'native_env_disabled', 'native_env_unavailable', 'native_env_early',
  'native_env_candidates_inferred', 'native_env_candidates_unavailable', 'native_env_file_changed',
  'workers_opt_in', 'workers_disabled', 'worker_attached', 'worker_shared_env',
  'worker_shape_unsupported', 'worker_depth_limit', 'worker_count_limit', 'worker_unconfirmed',
  'worker_outlived_root', 'adapter_manifest_unverified', 'failure_boundary_recorded',
]);
export type Notice = z.infer<typeof NoticeSchema>;
export const CoverageSchema = z.object({
  feature: z.enum(['environment', 'startup', 'dotenv', 'source-maps', 'children', 'native', 'native-env', 'workers', 'adapters']),
  status: z.enum(['active', 'limited', 'not-observed', 'unsupported']),
  reasons: z.array(NoticeSchema).max(64),
}).strict();
export type Coverage = z.infer<typeof CoverageSchema>;

export const EventSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_:-]{1,100}$/),
  processId: id,
  seq: z.number().int().nonnegative(),
  at: z.number().finite().nonnegative(),
  operation: z.enum(['baseline', 'read', 'write', 'delete', 'candidate', 'skip', 'load', 'child-spawn', 'worker-spawn', 'boundary']),
  key: z.string().max(128).optional(),
  value: ValueSchema.optional(),
  before: ValueSchema.optional(),
  candidate: ValueSchema.optional(),
  site: SiteSchema.optional(),
  origin: OriginSchema.optional(),
  causedBy: z.string().max(100).optional(),
  purpose: z.enum(['application', 'loader']).optional(),
  outcome: z.enum(['applied', 'not-applied', 'read-success', 'read-failed', 'spawned', 'spawn-failed', 'declared']).optional(),
  childId: id.optional(),
  environmentMode: z.enum(['copied', 'explicit', 'shared', 'unknown']).optional(),
  phase: z.enum(['startup', 'runtime']).optional(),
  loaderMethod: z.enum(['process.loadEnvFile', '--env-file', '--env-file-if-exists']).optional(),
  boundaryKind: z.enum(['manual', 'uncaught-exception']).optional(),
}).strict().superRefine((event, ctx) => {
  if (!['load', 'child-spawn', 'worker-spawn', 'boundary'].includes(event.operation) && (!event.key || !event.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Key operations require a key and masked value' });
  }
});
export type Observation = z.infer<typeof EventSchema>;

export const ProcessSchema = z.object({
  id, parentId: id.optional(), role: z.enum(['root', 'child', 'worker']),
  threadId: z.number().int().nonnegative().optional(),
  environmentMode: z.enum(['copied', 'explicit', 'shared', 'unknown']).optional(),
  caseMode: z.enum(['sensitive', 'insensitive']).optional(),
  pid: z.number().int().positive().nullable(), ppid: z.number().int().nonnegative().nullable(),
  node: z.string().max(32), platform: z.string().max(32),
  entry: text, startedAt: z.string().max(40).optional(),
  ended: z.boolean(), exitCode: z.number().int().nullable(),
  eventsDropped: z.number().int().nonnegative(),
}).strict();
export type ProcessInfo = z.infer<typeof ProcessSchema>;

export const AdapterManifestSchema = z.object({
  id, supportedVersions: z.string().max(160),
  capabilities: z.array(z.string().max(100)).max(16),
  evidenceTypes: z.array(z.string().max(64)).max(16),
  knownBypasses: z.array(z.string().max(256)).max(16),
  confidenceRules: z.array(z.string().max(256)).max(16),
}).strict();
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;
export const AdapterDeclarationSchema = z.object({
  processId: id, manifest: AdapterManifestSchema,
  installedVersion: z.string().max(80).optional(),
  validation: z.literal('unverified'),
}).strict();
export type AdapterDeclaration = z.infer<typeof AdapterDeclarationSchema>;

export const TraceSchema = z.object({
  schemaVersion: z.enum(['configtrace/1', 'configtrace/2']), toolVersion: z.enum(['0.2.0', '0.3.0', '0.3.1']),
  id,
  comparison: z.object({
    domainId: id, mode: z.enum(['hmac-sha256', 'export-hmac', 'none']),
  }).strict(),
  capture: z.object({
    status: z.enum(['complete', 'partial', 'failed']),
    watch: z.array(z.string().max(128)).max(256),
    caseMode: z.enum(['sensitive', 'insensitive']),
    maxEventsPerProcess: z.number().int().positive().max(MAX_EVENTS),
    notices: z.array(NoticeSchema).max(128),
  }).strict(),
  result: z.object({
    exitCode: z.number().int().nullable(), signal: z.string().max(32).nullable(),
  }).strict(),
  processes: z.array(ProcessSchema).max(MAX_PROCESSES),
  coverage: z.array(CoverageSchema).max(16),
  events: z.array(EventSchema).max(MAX_EVENTS),
  exported: z.boolean(),
  adapters: z.array(AdapterDeclarationSchema).max(512).optional(),
}).strict().superRefine((trace, ctx) => {
  const processes = new Set(trace.processes.map(p => p.id));
  const seen = new Map<string, Observation>();
  const sequence = new Map<string, number>();
  if (processes.size !== trace.processes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate process identifier' });
  }
  if (trace.processes.filter(p => p.role === 'root').length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Multiple root processes' });
  }
  const byId = new Map(trace.processes.map(p => [p.id, p]));
  for (const p of trace.processes) {
    const ancestors = new Set<string>([p.id]);
    let parent = p.parentId;
    while (parent) {
      if (ancestors.has(parent)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cyclic process ancestry' });
        break;
      }
      ancestors.add(parent); parent = byId.get(parent)?.parentId;
    }
  }
  for (const a of trace.adapters || []) if (!processes.has(a.processId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Adapter process is absent' });
  }
  for (const e of trace.events) {
    if (!processes.has(e.processId) || seen.has(e.id) || e.seq <= (sequence.get(e.processId) ?? -1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid event identity or sequence' });
      break;
    }
    if (['child-spawn', 'worker-spawn'].includes(e.operation) && e.childId) {
      const child = byId.get(e.childId);
      if (child && (child.parentId !== e.processId || child.role !== (e.operation === 'worker-spawn' ? 'worker' : 'child'))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Spawn evidence contradicts execution-context ancestry' });
        break;
      }
    }
    if (e.causedBy) {
      const cause = seen.get(e.causedBy);
      if (!cause || cause.processId !== e.processId || cause.key !== e.key) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid evidence link' });
        break;
      }
    }
    seen.set(e.id, e);
    sequence.set(e.processId, e.seq);
  }
});
export type Trace = z.infer<typeof TraceSchema>;

export const StreamRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), process: ProcessSchema }).strict(),
  z.object({ type: z.literal('event'), event: EventSchema }).strict(),
  z.object({ type: z.literal('adapter'), declaration: AdapterDeclarationSchema }).strict(),
  z.object({ type: z.literal('notice'), notice: NoticeSchema }).strict(),
  z.object({ type: z.literal('end'), exitCode: z.number().int(), eventsDropped: z.number().int().nonnegative() }).strict(),
]);
export type StreamRecord = z.infer<typeof StreamRecordSchema>;

export const KeyFileSchema = z.object({
  version: z.literal(1), domainId: id, secret: token,
}).strict();
export type ComparisonKey = z.infer<typeof KeyFileSchema>;
