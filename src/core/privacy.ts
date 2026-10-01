import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComparisonKey, SafeValue } from './schema';
import { BoundedCache } from './cache';
import { readBounded, writeNew, UserError, uniqueId } from './io';

export function createComparisonKey(): ComparisonKey {
  return { version: 1, domainId: uniqueId('d'), secret: randomBytes(32).toString('hex') };
}
export function writeComparisonKey(file: string): ComparisonKey {
  const key = createComparisonKey();
  writeNew(file, JSON.stringify(key, null, 2) + '\n');
  return key;
}
export function readComparisonKey(file: string): ComparisonKey {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new UserError('Comparison key must be a regular private file (chmod 600 on POSIX).', 65);
    }
    const { KeyFileSchema } = require('./schema') as typeof import('./schema');
    return KeyFileSchema.parse(JSON.parse(readBounded(file, 4096)));
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid comparison key file.', 65);
  }
}

/** Length framing prevents collisions across key/value boundaries. No raw-value cache. */
export function fingerprint(key: ComparisonKey, name: string, value: string | undefined): SafeValue {
  return fingerprintWithSecret(Buffer.from(key.secret, 'hex'), name, value);
}

/** One decoder per recorder. Captures only the secret bytes, never names or values. */
export function createFingerprinter(key: ComparisonKey): (name: string, value: string | undefined) => SafeValue {
  const secret = Buffer.from(key.secret, 'hex');
  return (name, value) => fingerprintWithSecret(secret, name, value);
}
function fingerprintWithSecret(secret: Buffer, name: string, value: string | undefined): SafeValue {
  if (value === undefined) return { state: 'missing' };
  const digest = createHmac('sha256', secret)
    .update('configtrace:value:v1\0').update(String(Buffer.byteLength(name))).update(':')
    .update(name).update(':').update(value).digest('hex');
  return { state: 'present', token: digest, empty: value.length === 0 };
}
export function sameValue(a?: SafeValue, b?: SafeValue): boolean {
  return !!a && !!b && a.state === b.state &&
    (a.state === 'missing' || (a.state === 'present' && b.state === 'present' && a.token === b.token));
}

export function globToRegex(pattern: string, insensitive = false): RegExp {
  const escaped = pattern.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$+.[\]{}()|]/g, '\\$&')).join('');
  return new RegExp(`^${escaped}$`, insensitive ? 'i' : '');
}
export function parseWatch(raw: string[]): string[] {
  const patterns = [...new Set(raw.flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean))];
  if (!patterns.length || patterns.length > 64 || patterns.some(p => !/^[A-Za-z_*?][A-Za-z0-9_.*?-]{0,127}$/.test(p))) {
    throw new UserError('Supply 1–64 environment key patterns using letters, digits, _, ., -, * and ?.');
  }
  return patterns;
}
export class WatchSet {
  private readonly regex: RegExp[];
  private readonly literals: Set<string>;
  private readonly literalList: string[];
  constructor(public readonly patterns: string[], public readonly insensitive: boolean) {
    // ASCII literals get the fast path. Non-ASCII library inputs retain RegExp /i semantics.
    const exact = patterns.filter(p => !/[*?]/.test(p) && /^[\x00-\x7f]*$/.test(p));
    this.literals = new Set(exact.map(p => this.canonical(p)));
    this.literalList = patterns.filter(p => !/[*?]/.test(p)).map(p => this.canonical(p));
    this.regex = patterns.filter(p => /[*?]/.test(p) || !/^[\x00-\x7f]*$/.test(p)).map(p => globToRegex(p, insensitive));
  }
  canonical(key: string): string { return this.insensitive ? key.toUpperCase() : key; }
  matches(key: unknown): key is string {
    if (typeof key !== 'string' || key.length > 128) return false;
    const upper = key.toUpperCase();
    if (upper.startsWith('__CONFIGTRACE_')) return false;
    // Uppercase expansion (e.g. sharp-s -> SS) must not broaden the old /i contract.
    const literal = (!this.insensitive || /^[\x00-\x7f]*$/.test(key)) && this.literals.has(this.insensitive ? upper : key);
    return literal || this.regex.some(r => r.test(key));
  }
  exact(): string[] { return [...this.literalList]; }
}

/** Metadata is minimized, not magically anonymized. Export can remove remaining project names. */
export class PathScrubber {
  private readonly cache = new BoundedCache<string, string>(512);
  constructor(private readonly root: string, private readonly salt: string) {}
  scrub(input: string): string {
    let file = input;
    try { if (file.startsWith('file://')) file = fileURLToPath(file); } catch { return '<unresolved>'; }
    file = file.split('?')[0].split('#')[0];
    if (file.startsWith('node:') || file.startsWith('<')) return file.slice(0, 256);
    // Query strings/fragments are discarded BEFORE looking up or retaining metadata.
    const cacheable = file.length <= 4096;
    const cached = cacheable ? this.cache.get(file) : undefined;
    if (cached !== undefined) return cached;
    const result = this.scrubNormalized(file);
    if (cacheable) this.cache.set(file, result);
    return result;
  }
  private scrubNormalized(file: string): string {
    const absolute = path.resolve(this.root, file);
    const relative = path.relative(this.root, absolute);
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/').slice(0, 512);
    }
    if (!relative) return '.';
    return `<external:${createHmac('sha256', this.salt).update(absolute).digest('hex').slice(0, 12)}>`;
  }
}
