import fs from 'node:fs';
import { isMainThread } from 'node:worker_threads';
import { z } from 'zod';
import { KeyFileSchema } from '../core/schema';
import { readBounded } from '../core/io';
import { Recorder } from './recorder';
import { installEnvironment } from './environment';
import { installDotenv } from '../adapters/dotenv';
import { installChildren } from './children';
import { ACTIVE_RECORDER, registerAdapter, type RuntimeConfig, type ConfigTraceAdapter } from './api';

const SessionSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]+$/), directory: z.string().max(4096), root: z.string().max(4096),
  rootId: z.string().regex(/^[A-Za-z0-9_-]+$/), watch: z.array(z.string().max(128)).min(1).max(64),
  comparison: KeyFileSchema, maxEvents: z.number().int().min(10).max(100000),
  maxBytes: z.number().int().min(16384).max(8 * 1024 * 1024),
  children: z.boolean(), maxDepth: z.number().int().min(0).max(4), maxChildren: z.number().int().min(1).max(16),
  sourceMaps: z.boolean(), dotenv: z.boolean(), adapters: z.array(z.string().max(4096)).max(8),
  preloadPath: z.string().max(4096), configPath: z.string().max(4096),
}).strict();

function start(): void {
  const registry = globalThis as unknown as Record<symbol, Recorder | undefined>;
  if (!isMainThread || registry[ACTIVE_RECORDER]) return;
  const originalEnv = process.env;
  const configPath = originalEnv.__CONFIGTRACE_CONFIG;
  if (!configPath) return; // A fork/Worker can inherit --require without a trace session.
  const instanceId = originalEnv.__CONFIGTRACE_INSTANCE;
  const parentId = originalEnv.__CONFIGTRACE_PARENT;
  const depth = Number(originalEnv.__CONFIGTRACE_DEPTH || '0');
  for (const key of ['__CONFIGTRACE_CONFIG', '__CONFIGTRACE_INSTANCE', '__CONFIGTRACE_PARENT', '__CONFIGTRACE_DEPTH']) delete originalEnv[key];
  let recorder: Recorder | undefined;
  const cleanups: Array<() => void> = [];
  try {
    const config: RuntimeConfig = SessionSchema.parse(JSON.parse(readBounded(configPath, 65536)));
    const id = instanceId || config.rootId;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || (parentId && !/^[A-Za-z0-9_-]{1,80}$/.test(parentId)) || !Number.isInteger(depth) || depth < 0 || depth > 4) return;
    recorder = new Recorder(config, id, parentId);
    const active = recorder;
    registry[ACTIVE_RECORDER] = active;
    active.notice('capture_unverified');
    active.notice('early_preloads_possible');
    active.notice('workers_unsupported');
    active.notice(config.sourceMaps ? 'source_maps_requested' : 'source_maps_opt_in');
    active.notice(config.children ? 'children_opt_in' : 'children_disabled');
    cleanups.push(installEnvironment(active, originalEnv));
    cleanups.push(installChildren(active, depth));
    if (config.dotenv) cleanups.push(installDotenv({ recorder: active, originalEnv, root: config.root }));
    for (const adapterPath of config.adapters) {
      try {
        const loaded = active.suppress(() => require(adapterPath)) as ConfigTraceAdapter | { default: ConfigTraceAdapter };
        const adapter = 'default' in loaded ? loaded.default : loaded;
        cleanups.push(registerAdapter(adapter, { recorder: active, originalEnv, root: config.root }));
      } catch { active.notice('adapter_failed'); }
    }
    process.once('exit', code => {
      active.suppress(() => {
        for (const cleanup of cleanups.reverse()) {
          try { cleanup(); } catch { active.notice('adapter_failed'); }
        }
      });
      active.finish(code);
      delete registry[ACTIVE_RECORDER];
    });
  } catch {
    recorder?.notice('recorder_failed');
    for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch { /* no raw error logging */ } }
    recorder?.finish(0);
    delete registry[ACTIVE_RECORDER];
    try { fs.writeSync(2, '[configtrace] Recorder unavailable; application continues without full evidence.\n'); } catch { /* stdio may be closed */ }
  }
}
start();
