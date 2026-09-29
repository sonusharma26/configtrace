const { Worker } = require('node:worker_threads');
void process.env.CONFIGTRACE_FIXTURE;
new Worker(require('node:path').join(__dirname, 'worker.cjs'));
