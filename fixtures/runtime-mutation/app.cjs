void process.env.CONFIGTRACE_FIXTURE;
process.env.CONFIGTRACE_FIXTURE = 'synthetic-replacement';
void process.env.CONFIGTRACE_FIXTURE;
delete process.env.CONFIGTRACE_FIXTURE;
void process.env.CONFIGTRACE_FIXTURE;
process.env.CONFIGTRACE_FIXTURE = '';
void process.env.CONFIGTRACE_FIXTURE;
Object.defineProperty(process.env, 'CONFIGTRACE_FIXTURE', {
  value: 'synthetic-definition', writable: true, configurable: true, enumerable: true,
});
void process.env.CONFIGTRACE_FIXTURE;
console.log('Mutation fixture completed.');
