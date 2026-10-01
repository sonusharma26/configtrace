import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSourceMap } from 'node:module';
import type { CallSite } from '../core/schema';
import type { PathScrubber } from '../core/privacy';
import { BoundedCache } from '../core/cache';

// Scope mappings to a scrubber and invalidate when Node returns a different map.
// Misses are deliberately not cached: source maps may be registered after a read.
const mappedSites = new WeakMap<PathScrubber, BoundedCache<string, { map: NonNullable<ReturnType<typeof findSourceMap>>; site: CallSite }>>();

const ownRoot = path.resolve(__dirname, '..') + path.sep;
export function captureSite(scrubber: PathScrubber, sourceMaps: boolean): CallSite | undefined {
  const prepare = Error.prepareStackTrace;
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 40;
    Error.prepareStackTrace = (_error, stack) => stack;
    const holder: { stack?: unknown } = {};
    Error.captureStackTrace(holder, captureSite);
    const stack = holder.stack as NodeJS.CallSite[];
    for (const frame of stack) {
      let file = frame.getFileName();
      if (!file) continue;
      if (file.startsWith('file://')) { try { file = fileURLToPath(file); } catch { continue; } }
      if (file.startsWith('node:') || file.startsWith('internal/') || file.startsWith(ownRoot) || /[/\\]node_modules[/\\]dotenv[/\\]/.test(file)) continue;
      const line = frame.getLineNumber() ?? undefined;
      const column = frame.getColumnNumber() ?? undefined;
      if (sourceMaps && line && column) {
        try {
          const map = findSourceMap(file);
          const cacheKey = JSON.stringify([file, line, column]);
          let cache = mappedSites.get(scrubber);
          const cached = cache?.get(cacheKey);
          if (map && cached?.map === map) return { ...cached.site };
          const entry = map?.findEntry(line - 1, column - 1);
          if (entry && 'originalSource' in entry && 'originalLine' in entry && 'originalColumn' in entry
            && typeof entry.originalSource === 'string' && typeof entry.originalLine === 'number' && entry.originalLine >= 0) {
            let original = entry.originalSource;
            if (!original.startsWith('file://') && !path.isAbsolute(original)) original = path.resolve(path.dirname(file), original);
            const site: CallSite = { file: scrubber.scrub(original), line: entry.originalLine + 1, column: typeof entry.originalColumn === 'number' && entry.originalColumn >= 0 ? entry.originalColumn + 1 : undefined, mapping: 'source-map' };
            if (map && file.length <= 4096 && !/[?#]/.test(file)) {
              if (!cache) { cache = new BoundedCache(512); mappedSites.set(scrubber, cache); }
              cache.set(cacheKey, { map, site });
            }
            return { ...site };
          }
        } catch { /* Missing/malformed source maps never block the application. */ }
      }
      return { file: scrubber.scrub(file), line, column, mapping: sourceMaps ? 'unavailable' : 'generated' };
    }
    return undefined;
  } catch { return undefined; }
  finally { Error.prepareStackTrace = prepare; Error.stackTraceLimit = limit; }
}
