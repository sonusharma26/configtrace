import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Origin } from '../core/schema';
import type { AdapterContext } from '../runtime/api';

// Deliberately isolated use of Node's private CJS hook. See the compatibility matrix.
type AnyFunction = (...args: any[]) => any;
interface LoaderInternals {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => any;
  _resolveFilename: (request: string, parent: NodeModule | null) => string;
}
interface ReadFrame { lastRead?: { result: unknown; file?: string } }

/** Observe the installed dotenv implementation; do not replace its parser or populate logic. */
export function installDotenv(context: AdapterContext): () => void {
  const { recorder, originalEnv, root } = context;
  const internals = Module as unknown as LoaderInternals;
  const originalLoad = internals._load;
  const originalRead = fs.readFileSync;
  const frames: ReadFrame[] = [];
  const origins = new WeakMap<object, Map<string, Origin>>();
  const patched = new WeakSet<object>();
  const cleanups: Array<() => void> = [];
  let copies = 0;

  const readHook = function(this: unknown, ...args: any[]): any {
    const frame = frames.at(-1);
    if (!frame || recorder.suppressed) return Reflect.apply(originalRead, fs, args);
    let file: string | undefined;
    if (typeof args[0] === 'string') file = path.resolve(process.cwd(), args[0]);
    else if (args[0] instanceof URL && args[0].protocol === 'file:') file = fileURLToPath(args[0]);
    try {
      const result = Reflect.apply(originalRead, fs, args);
      frame.lastRead = { result, file };
      recorder.loader(file, 'read-success');
      return result;
    } catch (error) {
      frame.lastRead = undefined;
      recorder.loader(file, 'read-failed');
      throw error; // Preserve the loader's original exception, without recording its message.
    }
  };
  fs.readFileSync = readHook as typeof fs.readFileSync;

  function patch(filename: string, exported: any): void {
    if (!exported || typeof exported !== 'object' || patched.has(exported) || copies >= 8) return;
    let version: string;
    try {
      const packageFile = path.resolve(path.dirname(filename), '../package.json');
      const pkg = JSON.parse(Reflect.apply(originalRead, fs, [packageFile, 'utf8']) as string);
      if (pkg.name !== 'dotenv' || typeof pkg.version !== 'string') return;
      version = pkg.version;
    } catch { return; }
    if (!/^(16|17)\./.test(version) || typeof exported.populate !== 'function' || typeof exported.parse !== 'function') {
      recorder.notice('dotenv_version_unverified');
      return;
    }
    patched.add(exported);
    copies++;
    recorder.notice('dotenv_attached');

    function replace(name: string, make: (fn: AnyFunction) => AnyFunction): void {
      const original = exported[name];
      if (typeof original !== 'function') return;
      const wrapped = make(original);
      exported[name] = wrapped;
      cleanups.push(() => { if (exported[name] === wrapped) exported[name] = original; });
    }

    replace('parse', original => function(this: unknown, ...args: any[]) {
      const parsed = Reflect.apply(original, this, args);
      try {
        const read = frames.at(-1)?.lastRead;
        // Only associate a file when the exact result of the observed read was parsed.
        const file = read && read.result === args[0] ? read.file : undefined;
        const map = new Map<string, Origin>();
        if (parsed && typeof parsed === 'object') {
          for (const key of Object.keys(parsed)) if (recorder.watch.matches(key) && map.size < 256) {
            map.set(recorder.watch.canonical(key), { kind: 'dotenv', confidence: file ? 'observed' : 'unknown', file });
          }
          origins.set(parsed, map);
        }
        if (!file) recorder.notice('dotenv_source_unknown');
      } catch { recorder.notice('adapter_failed'); }
      return parsed;
    });

    replace('populate', original => function(this: unknown, ...args: any[]) {
      const [target, parsed, options] = args;
      const isEnvironment = target === process.env;
      const originalTarget = target === originalEnv;
      const candidates: Array<{ key: string; raw: string; before?: string; had: boolean; previousId?: string; origin: Origin }> = [];
      let canInspect = false;
      let override: boolean | undefined = false;
      try {
        if (options !== undefined) {
          const descriptor = Object.getOwnPropertyDescriptor(options, 'override');
          if (descriptor && (!('value' in descriptor) || typeof descriptor.value !== 'boolean')) override = undefined;
          else override = descriptor?.value ?? false;
        }
        const proto = parsed && Object.getPrototypeOf(parsed);
        canInspect = !!target && !!parsed && (proto === Object.prototype || proto === null);
        if (canInspect) {
          const map = origins.get(parsed);
          recorder.suppress(() => {
            for (const key of Object.keys(parsed)) {
              if (!recorder.watch.matches(key)) continue;
              if (candidates.length >= 256) { recorder.notice('key_limit'); break; }
              const item = Object.getOwnPropertyDescriptor(parsed, key);
              if (!item || !('value' in item) || typeof item.value !== 'string') continue;
              const before = Object.getOwnPropertyDescriptor(target, key);
              if (before && !('value' in before)) { canInspect = false; continue; }
              candidates.push({ key, raw: item.value, before: before?.value, had: !!before,
                previousId: recorder.latestId(key),
                origin: map?.get(recorder.watch.canonical(key)) ?? { kind: 'dotenv', confidence: 'unknown' },
              });
            }
          });
        }
        if (override === undefined || !canInspect) recorder.notice('dotenv_options_unsupported');
        if (originalTarget && !isEnvironment) recorder.notice('dotenv_custom_target');
      } catch { canInspect = false; recorder.notice('adapter_failed'); }

      if (isEnvironment && canInspect) {
        for (const item of candidates) recorder.observe('candidate', item.key, item.raw, { origin: item.origin });
      }
      const originFor = (key: string): Origin => candidates.find(c => recorder.watch.canonical(c.key) === recorder.watch.canonical(key))?.origin
        ?? { kind: 'dotenv', confidence: 'unknown' };
      const result = isEnvironment
        ? recorder.withOrigin(originFor, () => Reflect.apply(original, this, args))
        : Reflect.apply(original, this, args);
      try {
        if (canInspect) {
          const targetOrigins = origins.get(target) ?? new Map<string, Origin>();
          for (const item of candidates) {
            const after = recorder.suppress(() => Object.getOwnPropertyDescriptor(target, item.key)?.value);
            if (isEnvironment && item.had && recorder.latestId(item.key) === item.previousId && after === item.before) {
              // Observation: this supported populate call performed no captured assignment for the candidate.
              // We do not claim to have intercepted an internal "if (override)" branch.
              recorder.observe('skip', item.key, after, { origin: item.origin, candidate: item.raw, hasCandidate: true, outcome: 'not-applied' });
            }
            if (!isEnvironment && !originalTarget && after === item.raw && (!item.had || item.before !== after)) {
              // Intermediate multi-file merges use dotenv's documented precedence, hence inferred.
              targetOrigins.set(recorder.watch.canonical(item.key), { ...item.origin, confidence: item.origin.file ? 'inferred' : 'unknown' });
            } else if (!isEnvironment && !originalTarget && item.had && item.before === after && after === item.raw) {
              // Equal-valued candidates from different files cannot be disambiguated by a net snapshot.
              targetOrigins.set(recorder.watch.canonical(item.key), { kind: 'dotenv', confidence: 'unknown' });
            }
          }
          if (!isEnvironment && !originalTarget) origins.set(target, targetOrigins);
        }
      } catch { recorder.notice('adapter_failed'); }
      return result;
    });

    for (const name of ['config', 'configDotenv']) replace(name, original => function(this: unknown, ...args: any[]) {
      frames.push({});
      try {
        const opts = args[0];
        const desc = opts && typeof opts === 'object' ? Object.getOwnPropertyDescriptor(opts, 'processEnv') : undefined;
        if (desc && (!('value' in desc) || (desc.value && desc.value !== process.env))) recorder.notice('dotenv_custom_target');
      } catch { recorder.notice('dotenv_options_unsupported'); }
      try { return Reflect.apply(original, this, args); }
      finally { frames.pop(); }
    });
  }

  const loadHook = function(request: string, parent: NodeModule | null, isMain: boolean): any {
    const result = Reflect.apply(originalLoad, internals, [request, parent, isMain]);
    const relevant = request === 'dotenv' || request.startsWith('dotenv/') || /[/\\]dotenv[/\\]/.test(request)
      || !!parent?.filename?.match(/[/\\]dotenv[/\\]/);
    if (relevant) {
      try {
        const resolved = internals._resolveFilename(request, parent);
        if (/[/\\]lib[/\\]main\.js$/.test(resolved)) patch(resolved, result);
      } catch { recorder.notice('adapter_failed'); }
    }
    return result;
  };
  internals._load = loadHook;
  // Eagerly patch the cwd-resolved CJS dotenv export before ESM namespace snapshots can form.
  // This intentionally loads dotenv's main module early; it does not invoke config().
  try {
    const appRequire = createRequire(path.join(root, '__configtrace_resolve__.cjs'));
    const resolved = appRequire.resolve('dotenv');
    const exported = appRequire(resolved);
    patch(resolved, exported);
    recorder.notice('dotenv_eager_load');
  } catch { recorder.notice('dotenv_not_seen'); }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    if (internals._load === loadHook) internals._load = originalLoad;
    if (fs.readFileSync === readHook) fs.readFileSync = originalRead;
  };
}
