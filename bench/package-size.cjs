'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(!fs.existsSync(path.join(root,'dist/cli.js')))throw new Error('Package measurement requires existing dist files. This command never builds.');
const npmCli=process.env.npm_execpath;
const args=['pack','--dry-run','--ignore-scripts','--json'];
const child=npmCli?spawnSync(process.execPath,[npmCli,...args],{cwd:root,encoding:'utf8'}):spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:root,encoding:'utf8',shell:process.platform==='win32'});
if(child.status!==0)throw new Error('npm pack dry-run failed. No lifecycle script was requested.');
const pack=JSON.parse(child.stdout)[0],pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const runtime=Object.entries(lock.packages||{}).filter(([name,p])=>name&& !p.dev).map(([name])=>name);
function size(dir){let n=0;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;n+=entry.isDirectory()?size(file):fs.statSync(file).size;}return n;}
const installed=runtime.every(name=>fs.existsSync(path.join(root,name)))?runtime.reduce((n,name)=>n+size(path.join(root,name)),0):null;
process.stdout.write(JSON.stringify({schemaVersion:'configproof-package-measurement/1',name:pkg.name,version:pkg.version,
  compressedTarballBytes:pack.size,unpackedPackageBytes:pack.unpackedSize,files:pack.entryCount,
  declaredRuntimeDependencies:Object.keys(pkg.dependencies||{}).length,lockedRuntimeDependencyPackages:runtime.length,
  installedRuntimeDependencyBytes:installed,scope:'Existing distribution and locked runtime dependencies only; dev dependencies excluded. Symlinks not followed.'},null,2)+'\n');
