const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, 'does-not-exist.env')); }
catch (error) { console.log(JSON.stringify({ nativeErrorPreserved: error.code === 'ENOENT' })); }
void process.env.CONFIGTRACE_FIXTURE;
