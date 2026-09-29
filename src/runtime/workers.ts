import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import workers = require('node:worker_threads');
import type { Recorder } from './recorder';
import type { Observation } from '../core/schema';
import { uniqueId } from '../core/io';

export const WORKER_SESSION_KEY = '__configtrace_worker_session_v1';
export interface WorkerSession {
  configPath: string; id: string; parentId: string; depth: number;
  environmentMode: 'copied' | 'explicit' | 'shared';
}
/** Consume the thread-local clone, without touching process.env (especially SHARE_ENV). */
export function takeWorkerSession(): WorkerSession | undefined {
  const value = workers.getEnvironmentData(WORKER_SESSION_KEY);
  workers.setEnvironmentData(WORKER_SESSION_KEY, undefined);
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<WorkerSession>;
  if (typeof v.configPath !== 'string' || typeof v.id !== 'string' || typeof v.parentId !== 'string'
    || !Number.isInteger(v.depth) || !['copied', 'explicit', 'shared'].includes(v.environmentMode || '')) return undefined;
  return v as WorkerSession;
}
function claimSlot(recorder: Recorder): boolean {
  // Exclusive files make the worker budget session-wide, including workers in children.
  for (let slot = 0; slot < recorder.config.maxWorkers; slot++) {
    let fd: number;
    try { fd = fs.openSync(path.join(recorder.config.directory, `worker-slot-${slot}`), 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    fs.closeSync(fd); return true;
  }
  return false;
}
export function installWorkers(recorder: Recorder, depth: number): () => void {
  if (!recorder.config.workers) { recorder.notice('workers_disabled'); return () => {}; }
  recorder.notice('workers_opt_in');
  const module = workers as unknown as { Worker: typeof workers.Worker };
  const OriginalWorker = module.Worker;
  const WrappedWorker = new Proxy(OriginalWorker, {
    construct(target, args, newTarget) {
      let prepared: unknown[] | undefined;
      let session: WorkerSession | undefined;
      let previous = workers.getEnvironmentData(WORKER_SESSION_KEY);
      let mode: Observation['environmentMode'] = 'unknown';
      try {
        const options = args[1];
        if (options !== undefined && (!options || typeof options !== 'object' || Object.getPrototypeOf(options) !== Object.prototype
          || Object.values(Object.getOwnPropertyDescriptors(options)).some(d => !('value' in d)))) {
          recorder.notice('worker_shape_unsupported');
        } else if (depth >= recorder.config.maxDepth) recorder.notice('worker_depth_limit');
        else {
          const opts = options || {};
          const execArgv = opts.execArgv === undefined ? process.execArgv : opts.execArgv;
          if (!Array.isArray(execArgv) || !execArgv.every((arg: unknown) => typeof arg === 'string')) recorder.notice('worker_shape_unsupported');
          else if (!recorder.suppress(() => claimSlot(recorder))) recorder.notice('worker_count_limit');
          else {
            mode = opts.env === workers.SHARE_ENV ? 'shared' : opts.env === undefined ? 'copied' : 'explicit';
            if (mode === 'shared') recorder.notice('worker_shared_env');
            session = { configPath: recorder.config.configPath, id: uniqueId('p'), parentId: recorder.process.id, depth: depth + 1, environmentMode: mode };
            prepared = [args[0], { ...opts, execArgv: ['--require', recorder.config.preloadPath, ...execArgv] }];
            // Environment data is cloned synchronously by Worker construction. No env/workerData rewrite.
            previous = workers.getEnvironmentData(WORKER_SESSION_KEY);
          }
        }
      } catch { prepared = undefined; session = undefined; recorder.notice('worker_shape_unsupported'); }
      if (!prepared || !session) return Reflect.construct(target, args, newTarget);
      try { workers.setEnvironmentData(WORKER_SESSION_KEY, session); }
      catch { recorder.notice('worker_shape_unsupported'); return Reflect.construct(target, args, newTarget); }
      try {
        let instance: workers.Worker;
        try { instance = recorder.suppress(() => Reflect.construct(target, prepared!, newTarget)) as workers.Worker; }
        catch (error) { recorder.worker(session.id, 'spawn-failed', mode); throw error; }
        recorder.worker(session.id, 'spawned', mode);
        return instance;
      } finally {
        try { workers.setEnvironmentData(WORKER_SESSION_KEY, previous); }
        catch { recorder.notice('adapter_failed'); }
      }
    },
  });
  module.Worker = WrappedWorker;
  syncBuiltinESMExports();
  return () => { if (module.Worker === WrappedWorker) { module.Worker = OriginalWorker; syncBuiltinESMExports(); } };
}
