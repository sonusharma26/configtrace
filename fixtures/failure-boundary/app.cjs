const { markFailureBoundary } = require('../../dist/runtime/api.js');
process.env.CONFIGTRACE_FIXTURE = 'synthetic-before-boundary';
void process.env.CONFIGTRACE_FIXTURE;
markFailureBoundary();
process.env.CONFIGTRACE_FIXTURE = 'synthetic-after-boundary';
void process.env.CONFIGTRACE_FIXTURE;
process.exitCode = 17;
