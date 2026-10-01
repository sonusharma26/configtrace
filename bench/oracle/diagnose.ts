// Original 0.3.1 computation from commit 0f066c52; only import paths are adapted.
import type { Trace, Observation } from '../../src/core/schema';
import { compareValue, diffTraces, originLabel, siteLabel } from './analyze';
import { terminalSafe, UserError } from '../../src/core/io';

export interface DiagnosisOptions { leftProcess?: string; rightProcess?: string; beforeSeq?: number; limit?: number }
export interface EvidenceReference { run: 'broken' | 'working'; processId: string; eventId: string }
export interface DiagnosisFinding {
  key: string; classification: 'provenance-divergence' | 'value-divergence' | 'loader-divergence' | 'mutation-divergence' | 'read-path-divergence';
  confidence: 'high' | 'moderate' | 'limited'; score: number; reasons: string[];
  evidence: { startupChanged: boolean; readValueChanged: boolean; readSiteSame: boolean; originChanged: boolean;
    loaderOutcomeChanged: boolean; mutationOnlyInFailing: boolean; beforeKnownBoundary: boolean; sameDomain: boolean };
  references: EvidenceReference[]; sites: NonNullable<Observation['site']>[];
  firstRelevantSeq: number; firstDivergenceSeq?: number; rawValuesAvailable: false;
}
export interface Diagnosis {
  schemaVersion: 'configtrace-diagnosis/1'; status: 'divergences-observed' | 'no-divergence-established' | 'incomplete-or-incomparable';
  brokenId: string; workingId: string; leftProcess?: string; rightProcess?: string;
  boundary: { kind: 'manual-sequence' | 'manual' | 'uncaught-exception' | 'not-recorded'; seq?: number };
  sameDomain: boolean; captureComplete: boolean; coverageChanged: boolean;
  totalComparedKeys: number; readKeys: number; candidateCount: number; omittedCandidates: number;
  findings: DiagnosisFinding[]; earliestObservedDivergence?: { key: string; seq: number };
  rawValuesAvailable: false; conclusion: string; caveats: string[];
}
const loaderSignature = (events: Observation[]) => JSON.stringify(events.filter(e => e.operation === 'skip'
  || e.operation === 'write' && ['dotenv', 'native-env'].includes(e.origin?.kind || '')).map(e => [e.operation, e.outcome, originLabel(e)]));
const references = (events: Array<Observation | undefined>, run: EvidenceReference['run']): EvidenceReference[] => {
  const seen = new Set<string>();
  return events.filter((e): e is Observation => !!e && !seen.has(e.id) && !!seen.add(e.id)).slice(0, 10)
    .map(e => ({ run, processId: e.processId, eventId: e.id }));
};
/** Deterministic divergence ranking; never equates correlation with an established root cause. */
export function diagnoseTraces(broken: Trace, working: Trace, options: DiagnosisOptions = {}): Diagnosis {
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new UserError('Diagnosis limit must be between 1 and 100.');
  const diff = diffTraces(broken, working, options);
  const selected = broken.events.filter(e => e.processId === diff.leftProcess);
  const marker = selected.find(e => e.operation === 'boundary');
  if (options.beforeSeq !== undefined && (!Number.isInteger(options.beforeSeq) || !selected.some(e => e.seq === options.beforeSeq))) throw new UserError('--before-seq must identify an observed event in the selected failing context.', 65);
  const boundary: Diagnosis['boundary'] = options.beforeSeq !== undefined ? { kind: 'manual-sequence', seq: options.beforeSeq }
    : marker ? { kind: marker.boundaryKind || 'manual', seq: marker.seq } : { kind: 'not-recorded' };
  let readKeys = 0;
  const findings: DiagnosisFinding[] = [];
  for (const row of diff.rows) {
    const inBoundary = row.left.events.filter(e => boundary.seq === undefined || e.seq <= boundary.seq);
    const leftReads = inBoundary.filter(e => e.operation === 'read' && e.purpose !== 'loader');
    if (!leftReads.length) continue;
    readKeys++;
    const read = leftReads.at(-1)!;
    const leftEvents = inBoundary.filter(e => e.seq <= read.seq);
    const rightSiteLabels = new Set(row.right.reads.filter(r => r.site).map(siteLabel));
    const sameSites = leftReads.filter(e => e.site && rightSiteLabels.has(siteLabel(e)));
    // Align identical call-site occurrences, not unrelated final reads or OS timestamps.
    const rightSites = new Map<string, Observation[]>();
    for (const r of row.right.reads) { const label = siteLabel(r); const list = rightSites.get(label) || []; list.push(r); rightSites.set(label, list); }
    const occurrence = new Map<string, number>();
    let changedRead: Observation | undefined, comparedRead: Observation | undefined;
    for (const r of leftReads) {
      const label = siteLabel(r), position = occurrence.get(label) || 0;
      occurrence.set(label, position + 1);
      const counterpart = r.site ? rightSites.get(label)?.[position] : undefined;
      if (counterpart && compareValue(r.value, counterpart.value, diff.sameDomain) === 'different' && !changedRead) { changedRead = r; comparedRead = counterpart; }
    }
    const rightRead = comparedRead || (read.site ? rightSites.get(siteLabel(read))?.at(-1) : undefined) || row.right.lastRead;
    const rightEvents = row.right.events.filter(e => !rightRead || e.seq <= rightRead.seq);
    const startupChanged = row.startup === 'different';
    const originChanged = !!rightRead && originLabel(changedRead || read) !== originLabel(rightRead);
    const loaderOutcomeChanged = loaderSignature(leftEvents) !== loaderSignature(rightEvents);
    const writes = leftEvents.filter(e => ['write', 'delete'].includes(e.operation));
    const rightWrites = rightEvents.filter(e => ['write', 'delete'].includes(e.operation));
    const mutationOnlyInFailing = writes.length > 0 && rightWrites.length === 0;
    const readSiteSame = sameSites.length > 0;
    const readPathChanged = !readSiteSame && row.right.reads.length > 0 || row.right.reads.length === 0;
    if (!startupChanged && !changedRead && !originChanged && !loaderOutcomeChanged && !mutationOnlyInFailing && !readPathChanged) continue;
    const reasons: string[] = [];
    let score = 0;
    if (changedRead) { score += 8; reasons.push('Masked read state/value differs at the same captured call-site occurrence.'); }
    if (originChanged) { score += 5; reasons.push('The recorded read-origin descriptions differ.'); }
    if (loaderOutcomeChanged) { score += 4; reasons.push('Candidate application/skip evidence differs before the compared consumption points.'); }
    if (mutationOnlyInFailing) { score += 3; reasons.push('A write/delete was captured only in the failing-side interval.'); }
    if (startupChanged) { score += 2; reasons.push('Startup state or comparable fingerprints differ.'); }
    if (readSiteSame) { score += 2; reasons.push('Both runs consumed the key at a common recorded call site.'); }
    else { score += 1; reasons.push('A matching captured consumption site is absent; coverage or execution paths may differ.'); }
    if (boundary.seq !== undefined) { score += 1; reasons.push('The key was read at or before the selected failure boundary.'); }
    const divergenceSeq = startupChanged ? row.left.baseline?.seq : changedRead?.seq
      ?? (loaderOutcomeChanged ? leftEvents.find(e => e.operation === 'skip' || e.operation === 'write')?.seq : undefined)
      ?? (originChanged || readPathChanged ? read.seq : undefined);
    const positiveQuality = diff.completeStreams && diff.sameDomain && !diff.coverageChanged;
    findings.push({ key: row.key, classification: originChanged ? 'provenance-divergence' : changedRead || startupChanged ? 'value-divergence'
      : loaderOutcomeChanged ? 'loader-divergence' : mutationOnlyInFailing ? 'mutation-divergence' : 'read-path-divergence',
      confidence: positiveQuality && readSiteSame && score >= 12 ? 'high' : positiveQuality ? 'moderate' : 'limited', score, reasons,
      evidence: { startupChanged, readValueChanged: !!changedRead, readSiteSame, originChanged, loaderOutcomeChanged,
        mutationOnlyInFailing, beforeKnownBoundary: boundary.seq !== undefined, sameDomain: diff.sameDomain },
      references: [...references([row.left.baseline, changedRead, read, ...leftEvents.filter(e => e.operation === 'skip'), ...writes], 'broken'),
        ...references([row.right.baseline, rightRead, ...rightEvents.filter(e => e.operation === 'skip'), ...rightWrites], 'working')],
      sites: [read.site, rightRead?.site].filter((s): s is NonNullable<Observation['site']> => !!s)
        .filter((s, i, all) => all.findIndex(x => JSON.stringify(x) === JSON.stringify(s)) === i),
      firstRelevantSeq: leftReads[0].seq, firstDivergenceSeq: divergenceSeq, rawValuesAvailable: false });
  }
  findings.sort((a, b) => b.score - a.score || a.firstRelevantSeq - b.firstRelevantSeq || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const earliest = findings.filter(f => f.firstDivergenceSeq !== undefined).sort((a, b) => a.firstDivergenceSeq! - b.firstDivergenceSeq! || a.key.localeCompare(b.key))[0];
  const incomplete = !diff.completeStreams || !diff.sameDomain || diff.coverageChanged || !diff.leftProcess || !diff.rightProcess;
  return { schemaVersion: 'configtrace-diagnosis/1', status: incomplete ? 'incomplete-or-incomparable' : findings.length ? 'divergences-observed' : 'no-divergence-established',
    brokenId: broken.id, workingId: working.id, leftProcess: diff.leftProcess, rightProcess: diff.rightProcess, boundary,
    sameDomain: diff.sameDomain, captureComplete: diff.completeStreams, coverageChanged: diff.coverageChanged,
    totalComparedKeys: diff.rows.length, readKeys, candidateCount: findings.length, omittedCandidates: Math.max(0, findings.length - limit),
    findings: findings.slice(0, limit), earliestObservedDivergence: earliest ? { key: earliest.key, seq: earliest.firstDivergenceSeq! } : undefined,
    rawValuesAvailable: false, conclusion: findings.length ? 'Ranked observed configuration divergences; no root cause has been proven.' : 'No relevant divergence was established in the selected evidence. This is not proof of equivalence.',
    caveats: [...diff.caveats,
      'Scores and confidence labels describe evidence strength, not causal probabilities. The list is ranked and deduplicated by key, not a mathematically minimal causal set.',
      'Matching call-site occurrences is a deterministic comparison convention, not a causal alignment of concurrent requests.',
      ...(boundary.seq === undefined ? ['No failure marker was recorded. A nonzero process exit does not identify the first failing database call.'] : ['A boundary limits failing-side relevance; the working side uses corresponding captured consumption points.']),
      'High evidence confidence does not upgrade inferred provenance edges to directly observed causality.',
    ] };
}
export function diagnosisText(result: Diagnosis): string {
  const lines = ['CONFIGPROOF / DIAGNOSIS', `${result.status} · ${result.readKeys}/${result.totalComparedKeys} keys read in the selected interval`,
    `Failure boundary: ${result.boundary.kind}${result.boundary.seq !== undefined ? ' #' + result.boundary.seq : ''}`, ''];
  for (const [i, f] of result.findings.entries()) lines.push(`${i + 1}. ${f.key} — ${f.classification} (${f.confidence} evidence; score ${f.score})`,
    ...f.reasons.map(r => `   ${r}`), `   Evidence: ${f.references.map(r => `${r.run}:${r.eventId}`).join(', ')}`, '');
  lines.push(result.conclusion, ...result.caveats.map(c => `Note: ${c}`));
  return terminalSafe(lines.join('\n'), true) + '\n';
}
