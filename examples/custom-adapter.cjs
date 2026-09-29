// Explicitly trusted local code. This is a minimal adapter contract example,
// not a node-config/convict/NestJS implementation.
module.exports = {
  id: 'example-local-loader',
  manifest: {
    id: 'example-local-loader',
    supportedVersions: 'Application-specific demonstration; no external library claims',
    capabilities: ['application-defined-evidence'],
    evidenceTypes: ['write'],
    knownBypasses: ['Only calls explicitly instrumented by the application are covered'],
    confidenceRules: ['Emit observed only for intercepted operations; preserve unknown history'],
  },
  install({ recorder }) {
    // Put synchronous installation here; use recorder.observe for raw-value-bearing
    // events so fingerprinting happens before persistence. Do not log values.
    // Example inside a real intercepted, successful write:
    // recorder.observe('write', key, resultingString, {
    //   origin: { kind: 'adapter', adapterId: 'example-local-loader', confidence: 'observed' }
    // });
    return () => { /* Restore only hooks owned by this adapter. */ };
  },
};
