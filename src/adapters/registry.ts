import type { AdapterManifest } from '../core/schema';

export const DOTENV_MANIFEST: AdapterManifest = {
  id: 'dotenv', supportedVersions: 'dotenv 16.x / 17.x (implementation targets; not validated)',
  capabilities: ['candidate', 'applied', 'skipped', 'source-file'],
  evidenceTypes: ['load', 'candidate', 'write', 'skip', 'read'],
  knownBypasses: ['Original process.env references', 'Custom processEnv targets', 'Unrecognized copies or bundled loaders'],
  confidenceRules: ['An intercepted file-read/parse identity is observed.', 'Intermediate merges and matching read origins are inferred.', 'Unresolved file origins remain unknown.'],
};
export const NATIVE_ENV_MANIFEST: AdapterManifest = {
  id: 'node-native-env', supportedVersions: 'Node 22.14+ / 24.x with process.loadEnvFile and util.parseEnv',
  capabilities: ['runtime-load', 'before-after-state', 'candidate-inference', 'early-option-hint'],
  evidenceTypes: ['load', 'candidate', 'write', 'skip'],
  knownBypasses: ['Early --env-file execution precedes preload', 'Previously captured loadEnvFile references', 'Concurrent SHARE_ENV mutations', 'A candidate file may change between the extra read and native load'],
  confidenceRules: ['The native call and before/after observations are captured.', 'Candidate application and skipping are inferences from a separate bounded file read.', 'Early flags are declarations; startup provenance remains unknown.'],
};
export function adapterCatalog(): Array<{ state: 'implemented' | 'planned'; manifest: AdapterManifest }> {
  return [
    { state: 'implemented', manifest: DOTENV_MANIFEST },
    { state: 'implemented', manifest: NATIVE_ENV_MANIFEST },
    ...['node-config', 'convict', 'nestjs-config'].map(id => ({ state: 'planned' as const, manifest: {
      id, supportedVersions: 'None declared; adapter not implemented', capabilities: [], evidenceTypes: [],
      knownBypasses: ['No official adapter is installed for this ecosystem.'],
      confidenceRules: ['No configuration-object provenance is inferred from environment tracing alone.'],
    } })),
  ];
}
