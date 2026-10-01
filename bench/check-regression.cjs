'use strict';
// An opt-in candidate policy, not statistical proof. Refuses incomparable/undersampled runs.
const fs=require('node:fs');
const [before,after]=process.argv.slice(2);
if(!before||!after)throw new Error('Usage: node bench/check-regression.cjs baseline.json candidate.json');
const a=JSON.parse(fs.readFileSync(before,'utf8')),b=JSON.parse(fs.readFileSync(after,'utf8'));
const incompatible=['execution','method','node','platform','arch','cpu'].filter(k=>a[k]!==b[k]);
if(a.execution!=='distribution'||b.execution!=='distribution'||incompatible.length){console.error('Inconclusive: use comparable built-distribution measurements, not source smoke timings.');process.exitCode=3;}
else{
 const findings=[];let missing=false;
 for(const current of b.results){
  const old=a.results.find(c=>c.events===current.events&&c.keys===current.keys);
  if(!old||current.optimized.samples<20||old.optimized.samples<20){missing=true;continue;}
  for(const [metric,previous,next,limit] of [
   ['diagnosis median',old.optimized.latencyMs.median,current.optimized.latencyMs.median,1.05],
   ['analysis-process peak RSS',old.optimized.memory.peakProcessRssBytes,current.optimized.memory.peakProcessRssBytes,1.05],
   ['compact artifact bytes/event',old.optimized.artifactBytes.compact/old.events,current.optimized.artifactBytes.compact/current.events,1.03]])
   findings.push({events:current.events,keys:current.keys,metric,ratio:next/previous,limit,pass:next<=previous*limit});
 }
 if(a.results.length!==b.results.length)missing=true;
 const failed=findings.some(f=>!f.pass);
 process.stdout.write(JSON.stringify({status:missing?'inconclusive':failed?'regression':'within-candidate-thresholds',findings,
  caveat:'Thresholds are review rules, not significance tests. Capture overhead and package size require their separate measurements.'},null,2)+'\n');
 process.exitCode=missing?3:failed?2:0;
}
