import type { Observation, SafeValue } from '../core/schema';
import type { ProvenanceGraph } from '../analysis/provenance';
import { originLabel, siteLabel } from '../core/analyze';

type Label = (value: SafeValue | undefined, key: string, domain: string) => string;
/** JSON fields are dictionary references, not raw artifact objects or value tokens. */
export class CompactReport {
  private readonly strings = [''];
  private readonly ids = new Map<string, number>([['', 0]]);
  private readonly timelines: number[][][] = [];
  private nodes: number[][] = [];
  private edges: number[][] = [];
  private text(value: string | undefined): number {
    const text = value || '';
    const known = this.ids.get(text);
    if (known !== undefined) return known;
    const index = this.strings.length; this.strings.push(text); this.ids.set(text, index); return index;
  }
  timeline(events: Observation[], domain: string, label: Label, graphIds: Set<string>, prefix = ''): string {
    const group = this.timelines.length;
    this.timelines.push(events.map(e => [
      this.text(`event${prefix}-${e.id}`), this.text(e.processId), this.text(e.operation),
      this.text(e.key || (e.operation === 'load' ? 'loader observation' : e.operation === 'boundary' ? 'failure boundary' : 'execution context boundary')),
      e.at, this.text(label(e.value, e.key || '', domain)), this.text(originLabel(e)), this.text(e.outcome),
      this.text(siteLabel(e)), this.text(e.candidate ? label(e.candidate, e.key || '', domain) : ''),
      this.text(e.causedBy), this.text(graphIds.has(`event:${e.id}`) ? `node-event:${e.id}` : ''), this.text(e.childId), this.text(e.key),
    ]));
    return `<ol class="timeline" data-ct-timeline="${group}"></ol>`;
  }
  graph(graph: ProvenanceGraph, operations: Map<string, Observation['operation']>, shown: Set<string>): void {
    this.nodes = graph.nodes.map(n => [this.text(n.id), this.text(n.kind), this.text(n.label), this.text(n.confidence),
      this.text(n.processId), this.text(n.key), this.text(n.eventId ? operations.get(n.eventId) : ''),
      this.text(n.state), n.empty ? 1 : 0, this.text(n.eventId && shown.has(n.eventId) ? n.eventId : ''), n.seq ?? -1]);
    this.edges = graph.edges.map(e => [this.text(e.from), this.text(e.to), this.text(e.relation), this.text(e.confidence)]);
  }
  data(): string {
    // Escape '<' even in inert JSON: HTML parsers recognize </script> before JSON parsing.
    const data = JSON.stringify({ version: 1, strings: this.strings, timelines: this.timelines, nodes: this.nodes, edges: this.edges })
      .replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return `<script type="application/json" id="ct-evidence-data">${data}</script>`;
  }
}

/** Fixed trusted renderer. Untrusted metadata enters only textContent/dataset/fragment URLs. */
export const compactBrowserScript = `
(()=>{'use strict';const source=document.getElementById('ct-evidence-data');if(!source)return;
const d=JSON.parse(source.textContent);if(d.version!==1)throw new Error('Unsupported evidence representation');
const s=i=>d.strings[i]||'';
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
const badge=text=>make('span','badge '+text,text);
const link=(target,text,jump)=>{const e=make('a','small',text);e.setAttribute('href','#'+target);if(jump)e.dataset.jump=jump;return e;};
for(const target of document.querySelectorAll('[data-ct-timeline]')){
 const fragment=document.createDocumentFragment();
 for(const r of d.timelines[Number(target.dataset.ctTimeline)]||[]){
  const item=make('li','event');item.id=s(r[0]);item.dataset.process=s(r[1]);item.dataset.op=s(r[2]);
  item.dataset.search=[s(r[13]),s(r[2]),s(r[1]),s(r[8]),s(r[6])].join(' ').toLowerCase();
  const top=make('div','event-top');top.append(make('time','','+'+r[4].toFixed(3)+' ms'),badge(s(r[2])),make('span','event-key mono',s(r[3])),make('span','mono small',s(r[5])));
  const body=make('div','event-body');body.append(make('div','',s(r[6])+(r[7]?' · '+s(r[7]):'')),make('div','mono muted',s(r[8])));
  if(r[9]){const candidate=make('div','','Candidate: ');candidate.append(make('span','mono',s(r[9])));body.append(candidate);}
  if(r[10])body.append(make('div','small muted','Inferred link to '+s(r[10])));
  if(r[11])body.append(link(s(r[11]),'View provenance node','provenance'));
  if(r[12])body.append(make('div','small mono','Child '+s(r[12])));
  item.append(top,body);fragment.append(item);
 }
 target.append(fragment);
}
const grid=document.getElementById('ct-graph-nodes'),table=document.getElementById('ct-graph-edges');
const labels=new Map();
if(grid){const fragment=document.createDocumentFragment();for(const r of d.nodes){
 const id=s(r[0]);labels.set(id,s(r[2]));const node=make('article','graph-node');node.id='node-'+id;
 node.dataset.confidence=s(r[3]);node.dataset.process=s(r[4]);node.dataset.op=s(r[6]);node.dataset.search=[s(r[2]),s(r[5]),s(r[4]),s(r[1])].join(' ').toLowerCase();
 node.append(make('div','stage',s(r[1])),make('h3','',s(r[2])),badge(s(r[3])));
 if(r[7])node.append(make('p','small mono',s(r[7])+(r[8]?' / empty':'')));
 if(r[9]){const p=make('p');p.append(link('event-'+s(r[9]),'Timeline #'+r[10],'timeline'));node.append(p);}
 fragment.append(node);
}grid.append(fragment);}
if(table){const fragment=document.createDocumentFragment();for(const r of d.edges){
 const from=s(r[0]),to=s(r[1]),row=make('tr','graph-edge');row.dataset.from='node-'+from;row.dataset.to='node-'+to;
 const a=make('td'),b=make('td'),c=make('td'),e=make('td');a.append(link('node-'+from,labels.get(from)||''));b.textContent=s(r[2]);c.append(link('node-'+to,labels.get(to)||''));e.append(badge(s(r[3])));row.append(a,b,c,e);fragment.append(row);
}table.append(fragment);}
})();
`;
