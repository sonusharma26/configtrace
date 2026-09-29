if (globalThis.__configtraceSavedOriginalEnv) {
  globalThis.__configtraceSavedOriginalEnv.CONFIGTRACE_FIXTURE = 'synthetic-bypass';
  void globalThis.__configtraceSavedOriginalEnv.CONFIGTRACE_FIXTURE;
}
void process.env.CONFIGTRACE_FIXTURE;
console.log('An original-reference bypass must not acquire a fictional write origin.');
