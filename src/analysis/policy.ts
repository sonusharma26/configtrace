import { TraceIndex } from '../core/event-index';
import { z } from 'zod';
import { parseDocument } from 'yaml';
import type { Trace, Observation, Origin, Coverage } from '../core/schema';
import { NoticeSchema } from '../core/schema';
import { evidenceFor, processFor, compareValue } from '../core/analyze';
import { globToRegex } from '../core/privacy';
import { readBounded, UserError, terminalSafe } from '../core/io';

const feature = z.enum(['environment', 'startup', 'dotenv', 'source-maps', 'children', 'native', 'native-env', 'workers', 'adapters']);
const RuleSchema = z.object({
  required: z.boolean().optional(), missing: z.boolean().optional(),
  read: z.enum(['required', 'forbidden', 'any']).optional(),
  immutableAfterFirstRead: z.boolean().optional(),
  allowedOrigins: z.array(z.string().min(1).max(512)).min(1).max(32).optional(),
  forbiddenOrigins: z.array(z.string().min(1).max(512)).min(1).max(32).optional(),
  consistentProvenance: z.boolean().optional(), noLoaderSkip: z.boolean().optional(),
  minimumConfidence: z.enum(['observed', 'derived', 'inferred']).default('inferred'),
}).strict().superRefine((rule, ctx) => {
  if (rule.required && rule.missing) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A key cannot be required and required missing.' });
});
export const VerificationPolicySchema = z.object({
  version: z.literal(1).default(1),
  rules: z.record(z.string().regex(/^[A-Za-z_*?][A-Za-z0-9_.*?-]{0,127}$/), RuleSchema)
    .refine(rules => Object.keys(rules).length <= 64, 'At most 64 rules are allowed.').default({}),
  coverage: z.object({
    requireComplete: z.boolean().default(true), maxDroppedEvents: z.number().int().nonnegative().max(100000).default(0),
    requireFeatures: z.array(feature).max(16).default(['environment']),
    forbidNotices: z.array(NoticeSchema).max(64).default([]),
  }).strict().default({}),
}).strict();
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;
export interface VerificationCheck {
  key?: string; rule: string; status: 'pass' | 'violation' | 'inconclusive'; reason: string; evidenceIds: string[];
}
export interface VerificationResult {
  schemaVersion: 'configtrace-verification/1'; traceId: string; processId?: string;
  status: VerificationCheck['status']; exitCode: 0 | 2 | 3;
  counts: { pass: number; violation: number; inconclusive: number };
  checks: VerificationCheck[]; rawValuesAvailable: false; caveats: string[];
}
export function readVerificationPolicy(file: string): VerificationPolicy {
  try {
    const doc = parseDocument(readBounded(file, 65536), { uniqueKeys: true, schema: 'core', strict: true });
    if (doc.errors.length) throw new Error('Invalid document');
    return VerificationPolicySchema.parse(doc.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid configuration contract. Unknown fields, duplicate keys, and YAML aliases are rejected.', 65);
  }
}
const level: Record<Origin['confidence'], number> = { unknown: 0, inferred: 1, derived: 2, observed: 3 };
function originIdentity(e: Observation): string | undefined {
  const o = e.origin;
  if (!o || o.kind === 'unknown' || o.confidence === 'unknown') return undefined;
  if (['dotenv', 'native-env'].includes(o.kind) && !o.file) return undefined;
  return `${o.kind}${o.kind === 'adapter' && o.adapterId ? ':' + o.adapterId : o.file ? ':' + o.file : ''}`;
}
/** Policies are evaluated over captured evidence. Absence under inadequate coverage is not a pass. */
export function verifyTrace(trace: Trace, supplied: unknown, options: { processId?: string; reference?: Trace; referenceProcess?: string; index?: TraceIndex; referenceIndex?: TraceIndex } = {}): VerificationResult {
  let policy: VerificationPolicy;
  try { policy = VerificationPolicySchema.parse(supplied); }
  catch { throw new UserError('Invalid configuration verification policy.', 65); }
  const processId = processFor(trace, options.processId);
  const info = trace.processes.find(p => p.id === processId);
  const complete = trace.capture.status === 'complete' && !!info?.ended;
  const insensitive = (info?.caseMode || trace.capture.caseMode) === 'insensitive';
  const index = options.index?.assertTrace(trace) || new TraceIndex(trace);
  const referenceIndex = options.reference ? options.referenceIndex?.assertTrace(options.reference) || new TraceIndex(options.reference) : undefined;
  const events = index.events(processId);
  const keys = [...new Set([...events.flatMap(e => e.key ? [e.key] : []), ...trace.capture.watch.filter(k => !/[*?]/.test(k)).map(k => insensitive ? k.toUpperCase() : k)])].sort();
  const checks: VerificationCheck[] = [];
  const evidenceCache = new Map<string, ReturnType<typeof evidenceFor>>();
  const referenceCache = new Map<string, ReturnType<typeof evidenceFor>>();
  const add = (rule: string, status: VerificationCheck['status'], reason: string, key?: string, evidence: Observation[] = []) =>
    checks.push({ key, rule, status, reason, evidenceIds: evidence.slice(0, 12).map(e => e.id) });
  if (!processId || !info) add('process', 'inconclusive', 'No selected execution context was captured.');
  if (policy.coverage.requireComplete) add('coverage.complete', complete ? 'pass' : 'inconclusive', complete ? 'The selected stream and artifact are complete within their declarations.' : 'The artifact or selected stream is incomplete.');
  const dropped = trace.processes.reduce((n, p) => n + p.eventsDropped, 0);
  add('coverage.maxDroppedEvents', dropped <= policy.coverage.maxDroppedEvents ? 'pass' : 'inconclusive', `${dropped} recorded dropped events; evidence cannot prove omitted operations.`);
  for (const expected of policy.coverage.requireFeatures) {
    const declaration: Coverage | undefined = trace.coverage.find(c => c.feature === expected);
    const present = declaration && ['active', 'limited'].includes(declaration.status);
    add(`coverage.${expected}`, present ? 'pass' : 'inconclusive', present ? 'Requested feature has an active/limited coverage declaration; its listed bypasses still apply.' : 'Requested feature has no usable coverage declaration.');
  }
  for (const notice of policy.coverage.forbidNotices) add('coverage.forbidNotices', trace.capture.notices.includes(notice) ? 'violation' : complete ? 'pass' : 'inconclusive', trace.capture.notices.includes(notice) ? `Forbidden capture notice: ${notice}.` : `Notice ${notice} was not captured.`);
  const loadersRemoved = trace.capture.notices.includes('loader_details_removed');
  for (const [pattern, rule] of Object.entries(policy.rules)) {
    const selector = globToRegex(pattern, insensitive);
    const matching = keys.filter(key => selector.test(key));
    if (!matching.length) { add('selector', 'inconclusive', 'Rule matched no captured key. Add a literal --watch selector before asserting absence.', pattern); continue; }
    for (const key of matching) {
      let evidence = evidenceCache.get(key);
      if (!evidence) { evidence = evidenceFor(trace, key, processId, index); evidenceCache.set(key, evidence); }
      const actual = evidence.events.filter(e => ['baseline', 'read', 'write', 'delete'].includes(e.operation));
      const consumed = evidence.reads.length ? evidence.reads : actual.length ? [actual.at(-1)!] : [];
      const usable = complete && actual.length > 0;
      if (rule.required || rule.missing) {
        const expected = rule.missing ? 'missing' : 'present';
        const violating = consumed.filter(e => e.value?.state !== 'omitted' && e.value?.state !== expected);
        const unknown = !consumed.length || consumed.some(e => !e.value || e.value.state === 'omitted');
        add(rule.missing ? 'missing' : 'required', violating.length ? 'violation' : unknown || !usable ? 'inconclusive' : 'pass',
          violating.length ? `Captured consumption/final state contradicts required state ${expected}.` : unknown ? 'No comparable consumption/final state was observed.' : `Captured application reads (or final captured state when unread) satisfy ${expected}.`, key, violating.length ? violating : consumed);
      }
      if (rule.read && rule.read !== 'any') {
        const exists = evidence.reads.length > 0;
        const passes = rule.read === 'required' ? exists : !exists;
        add('read', exists ? passes ? 'pass' : 'violation' : usable ? passes ? 'pass' : 'violation' : 'inconclusive',
          exists ? `${evidence.reads.length} application reads were captured.` : 'No application read was captured in the selected context.', key, evidence.reads);
      }
      if (rule.immutableAfterFirstRead) {
        const first = evidence.reads[0];
        let prior = first?.value;
        const changes: Observation[] = [];
        let unknown = !first || prior?.state === 'omitted';
        for (const e of actual.filter(e => first && e.seq > first.seq)) {
          if (e.operation === 'baseline') continue;
          const equality = compareValue(prior, e.value, trace.comparison.mode !== 'none');
          if (equality === 'different') changes.push(e);
          if (equality === 'incomparable' || equality === 'not-observed') unknown = true;
          prior = e.value;
        }
        add('immutableAfterFirstRead', changes.length ? 'violation' : unknown || !usable ? 'inconclusive' : 'pass',
          changes.length ? 'A value/state transition was captured after the first application read.' : unknown ? 'No comparable first-read sequence is available.' : 'No value/state transition was captured after the first application read.', key, first ? [first, ...changes] : []);
      }
      for (const kind of ['allowedOrigins', 'forbiddenOrigins'] as const) {
        const patterns = rule[kind]; if (!patterns) continue;
        let unknown = !consumed.length || loadersRemoved || trace.exported;
        const violating: Observation[] = [];
        for (const e of consumed) {
          const origin = originIdentity(e);
          if (!origin || level[e.origin?.confidence || 'unknown'] < level[rule.minimumConfidence] || e.value?.state !== 'present') { unknown = true; continue; }
          const matches = patterns.some(p => globToRegex(p).test(origin));
          if (kind === 'allowedOrigins' ? !matches : matches) violating.push(e);
        }
        add(kind, trace.exported ? 'inconclusive' : violating.length ? 'violation' : unknown || !usable ? 'inconclusive' : 'pass',
          trace.exported ? 'Export can alter source identities; source contracts require original local evidence.' : violating.length ? 'Captured origin contradicts the configured source rule.' : unknown ? 'Origin identity/confidence is insufficient for this rule.' : 'Captured origins satisfy this source rule at the requested confidence threshold.', key, violating.length ? violating : consumed);
      }
      const loaderCoverage = trace.coverage.some(c => ['dotenv', 'native-env'].includes(c.feature) && ['active', 'limited'].includes(c.status));
      if (rule.noLoaderSkip) add('noLoaderSkip', evidence.skips.length ? 'violation' : !usable || loadersRemoved || !loaderCoverage ? 'inconclusive' : 'pass',
        evidence.skips.length ? 'A loader candidate skip was captured.' : 'No loader skip was captured for this key.', key, evidence.skips);
      if (rule.consistentProvenance) {
        if (!options.reference) { add('consistentProvenance', 'inconclusive', 'A reference trace is required for paired provenance verification.', key); continue; }
        let other = referenceCache.get(key);
        if (!other) { other = evidenceFor(options.reference, key, options.referenceProcess, referenceIndex); referenceCache.set(key, other); }
        const a = evidence.reads.map(originIdentity), b = other.reads.map(originIdentity);
        const unknown = !a.length || !b.length || a.some(x => !x) || b.some(x => !x)
          || [...evidence.reads, ...other.reads].some(e => level[e.origin?.confidence || 'unknown'] < level[rule.minimumConfidence])
          || !options.reference.processes.find(p => p.id === other.processId)?.ended
          || !complete || options.reference.capture.status !== 'complete' || trace.exported || options.reference.exported;
        const same = JSON.stringify(a) === JSON.stringify(b);
        add('consistentProvenance', unknown ? 'inconclusive' : same ? 'pass' : 'violation', unknown ? 'Paired source evidence is absent, incomplete, or transformed.' : same ? 'Ordered captured read-origin identities match.' : 'Ordered captured read-origin identities differ.', key, evidence.reads);
      }
    }
  }
  const counts = { pass: checks.filter(c => c.status === 'pass').length, violation: checks.filter(c => c.status === 'violation').length,
    inconclusive: checks.filter(c => c.status === 'inconclusive').length };
  const status: VerificationResult['status'] = counts.violation ? 'violation' : counts.inconclusive ? 'inconclusive' : 'pass';
  return { schemaVersion: 'configtrace-verification/1', traceId: trace.id, processId, status, exitCode: status === 'pass' ? 0 : status === 'violation' ? 2 : 3,
    counts, checks, rawValuesAvailable: false, caveats: [
      'A pass applies only to the watched keys, selected context, captured operations, and declared coverage. It is not universal program verification.',
      'Source rules accept inferred origins by default. Raise minimumConfidence when an inferred match is insufficient.',
      'An observed violation takes precedence over unrelated incomplete evidence; both remain in the check results.',
      'Presence allows an empty string. Contracts do not read or compare raw configuration values.',
    ] };
}
export function verificationText(result: VerificationResult): string {
  return terminalSafe([`CONFIGPROOF / VERIFY — ${result.status.toUpperCase()}`,
    `${result.counts.pass} pass · ${result.counts.violation} violation · ${result.counts.inconclusive} inconclusive`,
    ...result.checks.map(c => `[${c.status}] ${c.key ? c.key + ' / ' : ''}${c.rule}: ${c.reason}`),
    ...result.caveats.map(c => `Note: ${c}`)].join('\n'), true) + '\n';
}
