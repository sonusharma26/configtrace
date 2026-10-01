'use strict';
const reads=Number(process.argv[2]),count=Number(process.argv[3]);
if(!Number.isInteger(reads)||reads<0||reads>99000||!Number.isInteger(count)||count<1||count>64)throw new Error('Invalid workload bounds');
const keys=Array.from({length:count},(_,i)=>`CP_BENCH_KEY_${i}`);
const cpu=process.cpuUsage(),start=process.hrtime.bigint();
let total=0;
for(let i=0;i<reads;i++){const value=process.env[keys[i%count]];total+=value?.length||0;}
const elapsed=Number(process.hrtime.bigint()-start)/1e6,used=process.cpuUsage(cpu);
process.stdout.write(JSON.stringify({loopMs:elapsed,cpuMs:(used.user+used.system)/1000,rssBytes:process.memoryUsage().rss,
  peakProcessRssBytes:process.resourceUsage().maxRSS*1024,reads,count,syntheticChecksum:total}));
