'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..'),cli=path.join(root,'dist/cli.js');
if(!fs.existsSync(cli))throw new Error('Capture benchmark requires an existing built checkout. It never builds or installs dependencies.');
const {readTrace}=require('../dist/core/io.js');
const {parseArgs}=require('node:util');
const {values}=parseArgs({options:{reads:{type:'string',default:'10000'},keys:{type:'string',default:'10'},samples:{type:'string',default:'7'},out:{type:'string'}},strict:true});
const reads=Number(values.reads),keys=Number(values.keys),samples=Number(values.samples);
if(!Number.isInteger(reads)||reads<0||reads>99000||!Number.isInteger(keys)||keys<1||keys>64||!Number.isInteger(samples)||samples<1||samples>100)throw new Error('Invalid workload bounds');
const names=Array.from({length:keys},(_,i)=>`CP_BENCH_KEY_${i}`);
const env={...process.env};for(const [i,key] of names.entries())env[key]=`CP_BENCH_CANARY_${i}`;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'configproof-perf-'));
const observations=[];
try{
 for(let i=0;i<samples;i++)for(const traced of [false,true]){
  const out=path.join(directory,`run-${i}.ct.json`);
  const command=[path.join(__dirname,'capture-workload.cjs'),String(reads),String(keys)];
  const args=traced?[cli,'run','--watch',names.join(','),'--out',out,'--max-events','100000','--no-dotenv','--no-native-env','--',process.execPath,...command]:command;
  const start=performance.now(),result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
  const wallMs=performance.now()-start;
  if(result.status!==0)throw new Error('Synthetic capture workload failed; inspect the checkout before benchmarking.');
  const row={traced,wallMs,...JSON.parse(result.stdout)};
  if(traced){
   const trace=readTrace(out);row.events=trace.events.length;row.captureStatus=trace.capture.status;row.artifactBytes=fs.statSync(out).size;
   if(trace.capture.status!=='complete'||trace.events.length!==reads+keys)throw new Error('Capture lost or added observations; a speed measurement would be invalid.');
   if(fs.readFileSync(out,'utf8').includes('CP_BENCH_CANARY_'))throw new Error('Synthetic value found in artifact.');
  }
  observations.push(row);
 }
 const output={schemaVersion:'configproof-capture-benchmark/1',node:process.version,platform:process.platform,arch:process.arch,
  reads,keys,samples,observations,limits:['Synthetic direct Node environment-access loop only; not general application overhead.',
   'wallMs includes CLI startup, app execution, collection and output. loopMs isolates the workload loop.',
   'Peak process RSS includes Node and preload initialization; it is not incremental idle memory.','Use --reads 0 for a separate idle/startup experiment.']};
 const text=JSON.stringify(output,null,2)+'\n';
 if(values.out){fs.mkdirSync(path.dirname(path.resolve(values.out)),{recursive:true});fs.writeFileSync(values.out,text,{flag:'wx'});}else process.stdout.write(text);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
