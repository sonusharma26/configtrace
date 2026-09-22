/** Trusted local adapter example; no application config is loaded or modified here. */
module.exports = {
  id: 'example-adapter',
  install({ recorder }) {
    // Real adapters should wrap their loader's existing operation, delegate it exactly once,
    // then send primitive observed values through recorder.observe(), never write raw logs.
    // The global function is merely an explicit opt-in observation hook for this example.
    const original = globalThis.recordConfigTraceRead;
    globalThis.recordConfigTraceRead = (key, value) => recorder.observe('read', key, value);
    return () => {
      if (original === undefined) delete globalThis.recordConfigTraceRead;
      else globalThis.recordConfigTraceRead = original;
    };
  },
};
