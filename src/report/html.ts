import { createHash } from 'node:crypto';
import type { Trace, Observation, SafeValue } from '../core/schema';
import { diffTraces, originLabel, siteLabel, valueLabel, type TraceDiff } from '../core/analyze';

const DISPLAY_LIMIT = 2000;
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
const css = `
:root{color-scheme:light;--paper:#f5f2eb;--ink:#252927;--muted:#626961;--line:#d6d6ca;--accent:#934726;--green:#28594c;--wash:#e9ece4}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--green)}header{border-bottom:3px solid var(--ink);padding:28px 5vw 22px;display:flex;gap:28px;justify-content:space-between;align-items:flex-end}
.wordmark{font:700 14px ui-monospace,monospace;letter-spacing:.12em}.edition{font:12px ui-monospace,monospace;color:var(--muted);text-align:right}h1{font-size:clamp(30px,5vw,56px);line-height:1.08;letter-spacing:-.04em;margin:24px 0 8px;font-weight:650}h2{font-size:20px;letter-spacing:-.02em}h3{font-size:16px;margin:0}p{margin:8px 0 16px}.subtitle{max-width:70ch;color:var(--muted)}main{max-width:1420px;margin:auto;padding:28px 5vw 72px}.notice{border-left:4px solid var(--accent);padding:12px 18px;background:#eee6d9;margin:0 0 24px}.muted{color:var(--muted)}.small{font-size:12px}.mono,code,time{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.stats{display:flex;flex-wrap:wrap;gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:20px 0}.stat{padding:15px 28px 15px 0;min-width:130px}.stat strong{display:block;font-size:24px}.stat span{text-transform:uppercase;font:10px ui-monospace,monospace;letter-spacing:.12em}.badge{display:inline-block;padding:3px 8px;border:1px solid var(--line);font:11px ui-monospace,monospace;text-transform:uppercase;white-space:nowrap}.badge.partial,.badge.failed,.different{color:var(--accent)}.same{color:var(--green)}.incomparable,.not-observed{color:var(--muted)}.toolbar{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin:22px 0}input,select,button{font:inherit;background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:2px;padding:9px 12px}input{min-width:220px;flex:1}input:focus,select:focus,button:focus{outline:2px solid var(--green);outline-offset:3px}button{cursor:pointer}.keys{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 24px}.keys button{font:12px ui-monospace,monospace;padding:6px 9px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--ink);margin-top:32px}details.process{border-bottom:1px solid var(--line)}summary{cursor:pointer;padding:15px 0;font-weight:600;overflow-wrap:anywhere}.timeline{list-style:none;margin:0;padding:0 0 10px 22px;border-left:1px solid var(--line)}.event{position:relative;padding:13px 0 13px 14px;border-bottom:1px solid var(--line)}.event:before{content:"";width:7px;height:7px;background:var(--ink);position:absolute;left:-26px;top:24px}.event[data-op="write"]:before,.event[data-op="skip"]:before{background:var(--accent)}.event-top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.event-top time{font-size:11px;color:var(--muted);min-width:105px}.event-key{font-weight:650}.event-body{margin:5px 0 0 118px;font-size:13px}.event-body div{overflow-wrap:anywhere}.coverage{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:0 25px}.coverage article{padding:16px 0;border-bottom:1px solid var(--line)}.coverage .reasons{font-size:12px;color:var(--muted);margin-top:8px}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th{font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;padding:12px 10px;border-bottom:2px solid var(--ink)}td{padding:14px 10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.table-wrap{overflow:auto}td:first-child{font-family:ui-monospace,monospace;min-width:170px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pair section{min-width:0}.pair .timeline{padding-left:13px}.pair .event:before{left:-17px}.pair .event-body{margin-left:0}.foot{border-top:1px solid var(--ink);padding-top:16px;margin-top:36px;color:var(--muted);font-size:12px}.caveat{margin:8px 0;color:var(--muted)}[hidden]{display:none!important}@media(max-width:700px){header{align-items:flex-start}.edition{max-width:115px}main{padding-left:5vw;padding-right:5vw}.event-body{margin-left:0}.event-top time{min-width:90px}.pair{grid-template-columns:1fr}.stat{min-width:100px;padding-right:16px}.timeline{padding-left:14px}.event:before{left:-18px}}@media print{.toolbar,.keys{display:none}body{background:white}details{display:block}.event{break-inside:avoid}header{padding:10px 0}main{padding:10px 0}a{text-decoration:none}.pair{display:block}}
`;
const script = `
(()=>{const q=document.getElementById('search'),op=document.getElementById('operation'),count=document.getElementById('visible-count');
const items=Array.from(document.querySelectorAll('.event'));
function filter(){const term=(q?q.value:'').trim().toLowerCase();const operation=op?op.value:'';let n=0;
for(const item of items){const visible=(!term||(item.dataset.search||'').includes(term))&&(!operation||item.dataset.op===operation);item.hidden=!visible;if(visible)n++;}
if(count)count.textContent=n+' rendered events visible';if(term)for(const d of document.querySelectorAll('details.process'))d.open=true;}
if(q)q.addEventListener('input',filter);if(op)op.addEventListener('change',filter);
for(const button of document.querySelectorAll('[data-key]'))button.addEventListener('click',()=>{if(q){q.value=button.dataset.key||'';filter();q.focus();}});filter();})();
`;
function shell(title: string, subtitle: string, body: string): string {
  const styleHash = createHash('sha256').update(css).digest('base64');
  const scriptHash = createHash('sha256').update(script).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; connect-src 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · ConfigTrace</title><style>${css}</style></head><body><header><div><div class="wordmark">CONFIGTRACE / EVIDENCE FILE</div><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p></div><div class="edition">CT—02<br>LOCAL / OFFLINE<br>NO RAW VALUES</div></header><main>${body}<footer class="foot">ConfigTrace 0.2.0 · A complete stream is not complete runtime coverage. Matching observations support an inference, not universal provenance. Review paths and key names before sharing. No external assets, scripts, fonts, or network requests.</footer></main><script>${script}</script></body></html>`;
}
function badge(status: string): string { return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`; }
function equality(status: string): string { return `<span class="mono ${escapeHtml(status)}">${escapeHtml(status)}</span>`; }
function labels(): (value: SafeValue | undefined, key: string, domain: string) => string {
  const seen = new Map<string, string>();
  return (value, key, domain) => {
    if (!value || value.state !== 'present') return valueLabel(value);
    const identity = JSON.stringify([domain, key, value.token]);
    if (!seen.has(identity)) seen.set(identity, `V${String(seen.size + 1).padStart(2, '0')}`);
    return `${seen.get(identity)} · masked`;
  };
}
function timeline(events: Observation[], domain: string, label: ReturnType<typeof labels>): string {
  return `<ol class="timeline">${events.map(e => {
    const search = [e.key, e.operation, e.processId, siteLabel(e), originLabel(e)].join(' ').toLowerCase();
    return `<li class="event" data-op="${escapeHtml(e.operation)}" data-search="${escapeHtml(search)}"><div class="event-top"><time>+${e.at.toFixed(3)} ms</time>${badge(e.operation)}<span class="event-key mono">${escapeHtml(e.key || (e.operation === 'load' ? 'dotenv file read' : 'child boundary'))}</span><span class="mono small">${escapeHtml(label(e.value, e.key || '', domain))}</span></div><div class="event-body"><div>${escapeHtml(originLabel(e))}${e.outcome ? ' · ' + escapeHtml(e.outcome) : ''}</div><div class="mono muted">${escapeHtml(siteLabel(e))}</div>${e.candidate ? `<div>Candidate: <span class="mono">${escapeHtml(label(e.candidate, e.key || '', domain))}</span></div>` : ''}${e.causedBy ? `<div class="small muted">Inferred link to ${escapeHtml(e.causedBy)}</div>` : ''}${e.childId ? `<div class="small mono">Child ${escapeHtml(e.childId)}</div>` : ''}</div></li>`;
  }).join('')}</ol>`;
}
function coverage(trace: Trace): string {
  return `<div class="section-head"><h2>Observation boundaries</h2><span class="small muted">Not a coverage percentage</span></div><div class="coverage">${trace.coverage.map(c => `<article><h3>${escapeHtml(c.feature)} ${badge(c.status)}</h3><div class="reasons mono">${c.reasons.map(x => escapeHtml(x.replace(/_/g, ' '))).join('<br>') || 'No adapter observation recorded.'}</div></article>`).join('')}</div>`;
}
function toolbar(): string {
  return `<div class="toolbar"><label for="search">Find evidence</label><input id="search" type="search" placeholder="Key, file, process, or origin" autocomplete="off"><label for="operation" class="small">Operation</label><select id="operation"><option value="">All</option>${['baseline','read','write','delete','candidate','skip','load','child-spawn'].map(x => `<option>${x}</option>`).join('')}</select><output id="visible-count" class="small muted" aria-live="polite"></output></div>`;
}
export function renderTraceHtml(trace: Trace): string {
  const keys = [...new Set(trace.events.flatMap(e => e.key ? [e.key] : []))].sort();
  const shown = trace.events.slice(0, DISPLAY_LIMIT);
  const label = labels();
  const body = `<div class="notice"><strong>${escapeHtml(trace.capture.status.toUpperCase())} CAPTURE.</strong> This describes recorder completeness, not universal visibility. Value labels are equality classes inside this report, not the original values.</div>
<div class="stats"><div class="stat"><strong>${keys.length}</strong><span>Observed keys</span></div><div class="stat"><strong>${trace.events.length}</strong><span>Events retained</span></div><div class="stat"><strong>${trace.processes.length}</strong><span>Processes</span></div><div class="stat"><strong>${escapeHtml(trace.result.signal || String(trace.result.exitCode ?? 'unknown'))}</strong><span>Application outcome</span></div></div>
${toolbar()}<div class="keys">${keys.slice(0, 80).map(k => `<button type="button" data-key="${escapeHtml(k)}">${escapeHtml(k)}</button>`).join('')}</div>
${shown.length < trace.events.length ? `<p class="notice">Display limit: showing ${shown.length} of ${trace.events.length} events. The JSON artifact retains the remaining evidence.</p>` : ''}
<div class="section-head"><h2>Runtime evidence</h2><span class="small muted">Process-local order · no global causal ordering</span></div>
${trace.processes.map((p, i) => `<details class="process" ${i === 0 ? 'open' : ''}><summary>${escapeHtml(p.role.toUpperCase())} / ${escapeHtml(p.entry)} <span class="small mono muted">${escapeHtml(p.id)}</span> ${badge(p.ended ? 'ended' : 'incomplete')}</summary><p class="small muted">${escapeHtml(p.node)} · ${escapeHtml(p.platform)} · ${p.eventsDropped} event(s) dropped</p>${timeline(shown.filter(e => e.processId === p.id), trace.comparison.domainId, label)}</details>`).join('')}
${coverage(trace)}<details><summary>Capture notices</summary><p class="small mono">${trace.capture.notices.map(x => escapeHtml(x.replace(/_/g, ' '))).join('<br>')}</p></details>`;
  return shell('Follow the value.', 'A selected-key record of what this Node process exposed to the recorder, and what remains unknown.', body);
}
export function renderDiffHtml(left: Trace, right: Trace, diff: TraceDiff = diffTraces(left, right)): string {
  const label = labels();
  const rows = diff.rows.map(r => `<tr><td>${escapeHtml(r.key)}</td><td>${equality(r.startup)}</td><td>${equality(r.lastRead)}</td><td>${equality(r.readSequence)}</td><td>${r.left.reads.length} → ${r.right.reads.length}</td><td>${escapeHtml(r.changes.join(', ') || 'No difference established')}</td></tr>`).join('');
  const evidence = diff.rows.slice(0, 100).map(r => `<details><summary>${escapeHtml(r.key)} / paired evidence</summary><p class="small">Origins: ${escapeHtml(originLabel(r.left.lastRead))} → ${escapeHtml(originLabel(r.right.lastRead))}</p><div class="pair"><section><h3>RUN A</h3>${timeline(r.left.events.slice(0, 40), left.comparison.domainId, label)}</section><section><h3>RUN B</h3>${timeline(r.right.events.slice(0, 40), right.comparison.domainId, label)}</section></div><p class="small muted">Showing up to 40 events per side. ${r.left.events.length} / ${r.right.events.length} retained for this key. Sequence equality: ${escapeHtml(r.readSequence)}.</p></details>`).join('');
  const body = `<div class="notice"><strong>${diff.sameDomain ? 'SHARED COMPARISON DOMAIN' : 'UNRELATED DOMAINS — VALUE EQUALITY UNKNOWN'}</strong><br>Compare captured evidence, not a claim that either execution was fully observed.</div>
<div class="stats"><div class="stat"><strong>${diff.rows.length}</strong><span>Keys compared</span></div><div class="stat"><strong>${diff.rows.filter(r => r.changes.length).length}</strong><span>Evidence differences</span></div><div class="stat"><strong>${diff.coverageChanged ? 'Changed' : 'Same manifest'}</strong><span>Coverage declarations</span></div></div>
<p class="small mono">A: ${escapeHtml(diff.leftProcess || 'not observed')} · B: ${escapeHtml(diff.rightProcess || 'not observed')}</p><div class="table-wrap"><table><thead><tr><th>Key</th><th>At preload</th><th>Last read</th><th>Read sequence</th><th>Read count</th><th>What changed</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="section-head"><h2>Read the difference.</h2><span class="small muted">Event presence is not causality</span></div>${diff.rows.length > 100 ? '<p class="notice">Detail display limit: the first 100 keys are expanded below. The summary table and source artifacts include the remaining keys.</p>' : ''}${evidence}
<div class="section-head"><h2>Interpretation limits</h2></div>${diff.caveats.map(c => `<p class="caveat">${escapeHtml(c)}</p>`).join('')}${coverage(left)}${coverage(right)}`;
  return shell('Two runs. One question.', 'What changed in the recorded configuration evidence between execution A and execution B?', body);
}
