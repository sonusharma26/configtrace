import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import * as util from 'node:util';
import { readBounded } from '../core/io';
import type { Origin } from '../core/schema';
import type { AdapterContext } from '../runtime/api';
import { NATIVE_ENV_MANIFEST } from './registry';

/** Only describes the options Node exposes. It does not re-run startup parsing. */
export function nativeEnvFlags(argv: readonly string[]): Array<{ file: string; method: '--env-file' | '--env-file-if-exists' }> {
  const results: Array<{ file: string; method: '--env-file' | '--env-file-if-exists' }> = [];
  const hasOperand = new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '-C']);
  for (let i = 0; i < argv.length && results.length < 32; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    if (hasOperand.has(arg)) { i++; continue; }
    for (const method of ['--env-file', '--env-file-if-exists'] as const) {
      if (arg.startsWith(method + '=')) results.push({ method, file: arg.slice(method.length + 1) });
      else if (arg === method && argv[i + 1]) results.push({ method, file: argv[++i] });
    }
  }
  return results;
}
function filePath(input: unknown): string | undefined {
  try {
    if (input === undefined) return path.resolve('.env');
    if (typeof input === 'string') return path.resolve(input);
    if (Buffer.isBuffer(input)) return path.resolve(input.toString('utf8'));
    if (input instanceof URL && input.protocol === 'file:') return fileURLToPath(input);
  } catch { /* Do not coerce arbitrary application objects or echo their contents. */ }
  return undefined;
}

export function installNativeEnv({ recorder, originalEnv }: AdapterContext): () => void {
  for (const flag of nativeEnvFlags(process.execArgv)) {
    recorder.notice('native_env_early');
    recorder.loader(filePath(flag.file), 'declared', { kind: 'native-env', phase: 'startup', method: flag.method, confidence: 'inferred' });
  }
  const nativeProcess = process as unknown as { loadEnvFile?: (...args: any[]) => unknown };
  const original = nativeProcess.loadEnvFile;
  if (typeof original !== 'function') { recorder.notice('native_env_unavailable'); return () => {}; }
  recorder.notice('native_env_attached');
  recorder.declareAdapter(NATIVE_ENV_MANIFEST, process.version);
  const parseEnv = (util as unknown as { parseEnv?: (text: string) => Record<string, string> }).parseEnv;
  const selected = (): string[] => [...new Set([...recorder.watch.exact(), ...Object.keys(originalEnv).filter(k => recorder.watch.matches(k))])].slice(0, 256);
  const snapshot = (keys: string[]): Map<string, string | undefined> => new Map(keys.map(k => [k, originalEnv[k]]));
  const stamp = (file: string): string | undefined => {
    try { const s = fs.statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { return undefined; }
  };
  const wrapped = function(this: unknown, ...args: any[]): unknown {
    if (recorder.suppressed) return Reflect.apply(original, this, args);
    let before = new Map<string, string | undefined>();
    let candidates = new Map<string, string>();
    let file: string | undefined;
    let initialStamp: string | undefined;
    const site = recorder.site();
    try {
      recorder.suppress(() => {
        file = filePath(args[0]);
        before = snapshot(selected());
        if (file && parseEnv) {
          initialStamp = stamp(file);
          try {
            const parsed = parseEnv(readBounded(file, 1024 * 1024));
            for (const [key, value] of Object.entries(parsed)) {
              if (!recorder.watch.matches(key)) continue;
              if (candidates.size >= 256) { recorder.notice('key_limit'); break; }
              candidates.set(key, value);
              if (!before.has(key)) before.set(key, originalEnv[key]);
            }
            recorder.notice('native_env_candidates_inferred');
          } catch { recorder.notice('native_env_candidates_unavailable'); }
        } else recorder.notice('native_env_candidates_unavailable');
      });
      for (const [key, value] of candidates) recorder.observe('candidate', key, value, {
        origin: { kind: 'native-env', confidence: 'inferred', file }, site,
      });
    } catch { recorder.notice('adapter_failed'); }
    let succeeded = false;
    try {
      // Execute the real implementation exactly once. Preserve its result and original exception.
      const result = recorder.suppress(() => Reflect.apply(original, this, args));
      succeeded = true;
      return result;
    } finally {
      try {
        recorder.loader(file, succeeded ? 'read-success' : 'read-failed', { kind: 'native-env', phase: 'runtime', method: 'process.loadEnvFile' });
        const stableFile = !!file && !!initialStamp && recorder.suppress(() => stamp(file!)) === initialStamp;
        if (file && initialStamp && !stableFile) recorder.notice('native_env_file_changed');
        const keys = [...new Set([...before.keys(), ...recorder.suppress(selected)])].slice(0, 256);
        for (const key of keys) {
          const after = recorder.suppress(() => originalEnv[key]);
          const old = before.get(key);
          const origin: Origin = { kind: 'native-env', confidence: recorder.sharedEnvironment ? 'inferred' : 'derived', file };
          if (old !== after) {
            recorder.observe(after === undefined ? 'delete' : 'write', key, after, {
              before: old, hasBefore: true, origin, outcome: 'applied', site,
            });
          } else if (succeeded && old !== undefined && candidates.has(key) && stableFile && !recorder.sharedEnvironment) {
            recorder.observe('skip', key, after, { candidate: candidates.get(key), hasCandidate: true,
              origin: { ...origin, confidence: 'inferred' }, outcome: 'not-applied', site });
          }
        }
      } catch { recorder.notice('adapter_failed'); }
      // No candidate or raw snapshot is retained after the call. JS strings are not secure-erased.
      before.clear(); candidates.clear();
    }
  };
  nativeProcess.loadEnvFile = wrapped;
  syncBuiltinESMExports();
  return () => { if (nativeProcess.loadEnvFile === wrapped) { nativeProcess.loadEnvFile = original; syncBuiltinESMExports(); } };
}
