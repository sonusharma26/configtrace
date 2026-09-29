import { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { uniqueId } from '../core/io';
import type { Recorder } from './recorder';

interface NormalizedSpawnOptions {
  file: string;
  args: string[];
  envPairs: string[];
  detached?: boolean;
  [key: string]: unknown;
}
type SpawnMethod = (this: ChildProcess, options: NormalizedSpawnOptions) => unknown;

/**
 * One contained normalized-spawn hook catches async spawn, execFile and fork, including
 * promisified execFile, without rewriting their public overloads or callback contracts.
 * This is a PRIVATE Node boundary: shape checks and the unverified support matrix matter.
 * Sync launches, shell commands, detached processes and Workers are not injected.
 */
export function installChildren(recorder: Recorder, depth: number): () => void {
  const proto = ChildProcess.prototype as unknown as { spawn: SpawnMethod };
  const original = proto.spawn;
  let count = 0;
  recorder.notice('sync_children_unobserved');
  if (typeof original !== 'function') { recorder.notice('child_shape_unsupported'); return () => {}; }

  const hook: SpawnMethod = function(options) {
    if (!options || typeof options.file !== 'string' || !Array.isArray(options.args) || !options.args.length || !options.args.every(x => typeof x === 'string') || !Array.isArray(options.envPairs) || !options.envPairs.every(x => typeof x === 'string')) {
      recorder.notice('child_shape_unsupported');
      return Reflect.apply(original, this, [options]);
    }
    const isNode = options.file === process.execPath || /^(node|node\.exe)$/i.test(options.file);
    let reason: Parameters<Recorder['notice']>[0] | undefined;
    if (!isNode) reason = 'child_shell_or_non_node';
    else if (options.detached) reason = 'child_detached';
    else if (!recorder.config.children) reason = 'children_disabled';
    else if (depth >= recorder.config.maxDepth) reason = 'child_depth_limit';
    else if (count >= recorder.config.maxChildren) reason = 'child_count_limit';
    if (reason) {
      recorder.notice(reason);
      return Reflect.apply(original, this, [options]);
    }
    count++;
    const childId = uniqueId('p');
    const envPairs = options.envPairs.filter(pair => !pair.toUpperCase().startsWith('__CONFIGTRACE_'));
    envPairs.push(`__CONFIGTRACE_CONFIG=${recorder.config.configPath}`,
      `__CONFIGTRACE_INSTANCE=${childId}`, `__CONFIGTRACE_PARENT=${recorder.process.id}`, `__CONFIGTRACE_DEPTH=${depth + 1}`);
    // A fork may already inherit our preload through execArgv. require caching prevents a second install.
    const args = [...options.args];
    const preload = path.resolve(recorder.config.preloadPath);
    args.splice(1, 0, '--require', preload, ...(recorder.config.sourceMaps ? ['--enable-source-maps'] : []));
    const prepared = { ...options, args, envPairs };
    try {
      const result = recorder.suppress(() => Reflect.apply(original, this, [prepared]));
      recorder.child(childId, this.pid ? 'spawned' : 'spawn-failed');
      return result;
    } catch (error) {
      recorder.child(childId, 'spawn-failed');
      throw error;
    }
  };
  proto.spawn = hook;
  return () => { if (proto.spawn === hook) proto.spawn = original; };
}
