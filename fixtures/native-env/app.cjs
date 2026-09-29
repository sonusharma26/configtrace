const path = require('node:path');
const before = process.env.CONFIGTRACE_FIXTURE;
process.loadEnvFile(path.join(__dirname, 'sample.env'));
const after = process.env.CONFIGTRACE_FIXTURE;
// No raw values in fixture output.
console.log(JSON.stringify({ beforePresent: before !== undefined, afterPresent: after !== undefined }));
