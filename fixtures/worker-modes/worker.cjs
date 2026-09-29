const { workerData } = require('node:worker_threads');
const value = process.env.CONFIGTRACE_FIXTURE;
if (workerData.mode === 'shared') process.env.CONFIGTRACE_FIXTURE = 'synthetic-shared-value';
void value;
