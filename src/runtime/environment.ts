import type { Recorder } from './recorder';

/** Delegate to the exotic original object: do not emulate Node's coercion or descriptors. */
export function installEnvironment(recorder: Recorder, original: NodeJS.ProcessEnv): () => void {
  const proxy = new Proxy(original, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof key === 'string' && (typeof value === 'string' || value === undefined)) recorder.observe('read', key, value);
      return value;
    },
    set(target, key, value) {
      const interested = !recorder.suppressed && recorder.watch.matches(key);
      const before = interested ? Reflect.get(target, key, target) as string | undefined : undefined;
      const result = Reflect.set(target, key, value, target);
      if (result && interested && typeof key === 'string') {
        recorder.observe('write', key, Reflect.get(target, key, target), { before, hasBefore: true, outcome: 'applied' });
      }
      return result;
    },
    deleteProperty(target, key) {
      const interested = !recorder.suppressed && recorder.watch.matches(key);
      const before = interested ? Reflect.get(target, key, target) as string | undefined : undefined;
      const result = Reflect.deleteProperty(target, key);
      if (result && interested && typeof key === 'string') recorder.observe('delete', key, Reflect.get(target, key, target), { before, hasBefore: true });
      return result;
    },
    defineProperty(target, key, descriptor) {
      const interested = !recorder.suppressed && recorder.watch.matches(key);
      const before = interested ? Reflect.get(target, key, target) as string | undefined : undefined;
      const result = Reflect.defineProperty(target, key, descriptor);
      if (result && interested && typeof key === 'string') recorder.observe('write', key, Reflect.get(target, key, target), { before, hasBefore: true, outcome: 'applied' });
      return result;
    },
  });
  process.env = proxy;
  const baseline = new Set([...recorder.watch.exact(), ...Object.keys(original).filter(k => recorder.watch.matches(k))]);
  for (const key of baseline) recorder.observe('baseline', key, original[key]);
  recorder.notice('startup_history_unknown');
  recorder.notice('original_reference_bypass');
  recorder.notice('native_access_unobserved');
  return () => {
    if (process.env !== proxy) recorder.notice('environment_replaced');
    else process.env = original;
  };
}
