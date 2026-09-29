const { Worker, SHARE_ENV } = require('node:worker_threads');
const path = require('node:path');
function once(mode, env) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), { env, workerData: { mode }, execArgv: [] });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Fixture worker failed')));
  });
}
(async () => {
  process.env.CONFIGTRACE_FIXTURE = 'synthetic-parent-value';
  await once('copied', undefined);
  await once('explicit', { CONFIGTRACE_FIXTURE: 'synthetic-explicit-value' });
  await once('shared', SHARE_ENV);
  const sharedWriteVisible = process.env.CONFIGTRACE_FIXTURE === 'synthetic-shared-value';
  console.log(JSON.stringify({ sharedWriteVisible }));
})().catch(() => { process.exitCode = 1; });
