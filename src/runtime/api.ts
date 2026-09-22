import type { Recorder } from './recorder';

export interface RuntimeConfig {
  runId: string;
  directory: string;
  root: string;
  rootId: string;
  watch: string[];
  comparison: { version: 1; domainId: string; secret: string };
  maxEvents: number;
  maxBytes: number;
  children: boolean;
  maxDepth: number;
  maxChildren: number;
  sourceMaps: boolean;
  dotenv: boolean;
  adapters: string[];
  preloadPath: string;
  configPath: string;
}

export interface AdapterContext {
  /** All value-bearing observations pass through the recorder's in-memory fingerprint boundary. */
  recorder: Recorder;
  originalEnv: NodeJS.ProcessEnv;
  root: string;
}
export interface ConfigTraceAdapter {
  id: string;
  /** Synchronous install. Return a cleanup function; never start telemetry or persist raw values. */
  install(context: AdapterContext): void | (() => void);
}

export const ACTIVE_RECORDER = Symbol.for('configtrace.active-recorder');
export function getActiveRecorder(): Recorder | undefined {
  return (globalThis as unknown as Record<symbol, Recorder>)[ACTIVE_RECORDER];
}
export function registerAdapter(adapter: ConfigTraceAdapter, context: AdapterContext): () => void {
  if (!adapter || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(adapter.id) || typeof adapter.install !== 'function') {
    throw new Error('Invalid ConfigTrace adapter contract');
  }
  const dispose = adapter.install(context);
  context.recorder.notice('custom_adapter_loaded');
  return typeof dispose === 'function' ? dispose : () => {};
}
