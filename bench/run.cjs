'use strict';
// Warm-core benchmark. Source-loader and fixture construction are outside latency timing.
// Each implementation/scenario runs in a fresh process so peak RSS isn't shared between cases.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance, PerformanceObserver } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const { makeTrace } = require('./fixtures.cjs');
function flag(name, fallback) { const i=process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i+1]; }
function integer(value, min, max) { const n=Number(value); if (!Number.isInteger(n)||n<min||n>max) throw new Error('Invalid benchmark bounds'); return n; }
const samples = integer(flag('--samples', '7'), 1, 1000);
const source = process.argv.includes('--source');
const quantile = (xs,q) => [...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(q*xs.length)-1)];
function sourceDigest(){const hash=crypto.createHash('sha256');function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else{hash.update(path.relative(root,file).split(path.sep).join('/'));hash.update('\0');hash.update(fs.readFileSync(file));hash.update('\0');}}}visit(path.join(root,'src'));hash.update(fs.readFileSync(path.join(root,'package-lock.json')));return hash.digest('hex');}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (process.argv.includes('--worker')) {
  const events=integer(flag('--events','1000'),8,100000), keys=integer(flag('--keys','8'),1,64);
  const implementation=flag('--implementation','optimized');
  // Oracle is retained source with only imports relocated. It is never shipped on npm.
  if (source || implementation === 'legacy') require('../scripts/register-source.cjs');
  const base=implementation==='legacy' ? path.join(__dirname,'oracle') : path.join(root,source?'src':'dist');
  if (!['legacy','optimized'].includes(implementation)) throw new Error('Unknown implementation');
  const diagnose=implementation==='legacy' ? require(path.join(base,'diagnose.ts')).diagnoseTraces
    : require(path.join(base,'analysis/diagnose.'+(source?'ts':'js'))).diagnoseTraces;
  const report=implementation==='legacy' ? require(path.join(base,'html.ts')).renderTraceHtml
    : require(path.join(base,'report/html.'+(source?'ts':'js'))).renderTraceHtml;
  const a=makeTrace(events,keys,0), b=makeTrace(events,keys,1);
  const warm=diagnose(a,b), expectedHash=digest(warm);
  const gc=[];
  const observer=new PerformanceObserver(list=>gc.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
  observer.observe({entryTypes:['gc']});
  const before=process.memoryUsage(), latencies=[], cpu=[];
  const start=performance.now();
  let deterministic=0;
  for(let i=0;i<samples;i++){
    const c=process.cpuUsage(), t=performance.now();
    const output=diagnose(a,b);
    latencies.push(performance.now()-t);
    const used=process.cpuUsage(c);cpu.push((used.user+used.system)/1000);
    if(digest(output)!==expectedHash)throw new Error('Nondeterministic diagnosis output');
    deterministic++;
  }
  const end=performance.now(), after=process.memoryUsage();
  const peakAtAnalysisEnd=process.resourceUsage().maxRSS*1024;
  const renderStart=performance.now();
  const html=report(a);
  const reportMs=performance.now()-renderStart;
  const compact=JSON.stringify(a)+'\n', pretty=JSON.stringify(a,null,2)+'\n';
  if(digest(JSON.parse(compact))!==digest(a))throw new Error('Serialization changed fixture');
  const result={implementation,events,keys,samples,resultHash:expectedHash,deterministic,
    latencyMs:{median:quantile(latencies,.5),p95:quantile(latencies,.95),samples:latencies},
    cpuMs:{median:quantile(cpu,.5),samples:cpu},
    memory:{rssBeforeBytes:before.rss,rssAfterBytes:after.rss,heapBeforeBytes:before.heapUsed,heapAfterBytes:after.heapUsed,
      peakProcessRssBytes:peakAtAnalysisEnd},
    artifactBytes:{pretty:Buffer.byteLength(pretty),compact:Buffer.byteLength(compact)},
    report:{bytes:Buffer.byteLength(html),renderMs:reportMs,displayLimit:2000},
  };
  setTimeout(()=>{
    observer.disconnect();
    const observed=gc.filter(e=>e.start>=start&&e.start<=end);
    result.gc={observedCollections:observed.length,observedDurationMs:observed.reduce((n,e)=>n+e.duration,0)};
    process.stdout.write(JSON.stringify(result));
  }, 25);
} else {
  if(!source&&!fs.existsSync(path.join(root,'dist/analysis/diagnose.js')))throw new Error('No built distribution exists. Use --source for warm source checks; this runner never builds.');
  const requested=String(flag('--events','1000,10000,50000,100000')).split(',').map(x=>integer(x,8,100000));
  const scenarios=requested.map(events=>({events,keys:events<=1000?8:events<=10000?16:events<=50000?32:64}));
  const results=[];
  for(const scenario of scenarios){
    const pair={...scenario};
    for(const implementation of ['legacy','optimized']){
      const args=[__filename,'--worker','--events',String(scenario.events),'--keys',String(scenario.keys),'--samples',String(samples),'--implementation',implementation];
      if(source)args.push('--source');
      const child=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
      if(child.status!==0)throw new Error('Benchmark worker failed: '+String(child.stderr).slice(0,2000));
      pair[implementation]=JSON.parse(child.stdout);
    }
    if(pair.legacy.resultHash!==pair.optimized.resultHash)throw new Error('Optimization changed diagnosis output');
    pair.observed={diagnosisSpeedup:pair.legacy.latencyMs.median/pair.optimized.latencyMs.median,
      reportBytesReductionPercent:100*(1-pair.optimized.report.bytes/pair.legacy.report.bytes),
      jsonBytesReductionPercent:100*(1-pair.optimized.artifactBytes.compact/pair.optimized.artifactBytes.pretty)};
    results.push(pair);
  }
  const output={schemaVersion:'configproof-benchmark/1',method:'warm-core-isolated-process',execution:source?'source-in-memory-transpile':'distribution',
    generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
    cpu:os.cpus()[0]?.model,baselineCommit:'0f066c52ba4e2bf67aab634e1deed6b0a5d07fe6',candidateSourceSha256:sourceDigest(),results,
    limitations:['Not end-to-end CLI latency or runtime capture overhead.','Source loader and fixture generation are outside latency timing but inside peak process RSS.',
      'HTML bytes use the existing 2000-event and 1600-node display caps, not a complete large-trace export.',
      '250000 events per trace are deliberately rejected; the production limit remains 100000.','A few samples are exploratory, not a release performance contract.']};
  const text=JSON.stringify(output,null,2)+'\n', out=flag('--out');
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,text,{flag:'wx'});}
  else process.stdout.write(text);
}
