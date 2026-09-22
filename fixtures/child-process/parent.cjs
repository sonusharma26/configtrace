const { spawn, fork } = require('node:child_process');
const path = require('node:path');
const child = path.join(__dirname, 'child.cjs');
spawn(process.execPath, [child], { env: { ...process.env, CONFIGTRACE_FIXTURE: 'synthetic-spawn' }, stdio: 'inherit' });
fork(child, [], { env: { ...process.env, CONFIGTRACE_FIXTURE: 'synthetic-fork' }, stdio: 'inherit' });
