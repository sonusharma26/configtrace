import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyFileSchema, type ComparisonKey, type SafeValue } from './schema';
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
    return KeyFileSchema.parse(JSON.parse(readBounded(file, 4096)));
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid comparison key file.', 65);
  }
}

/** Length framing prevents collisions across key/value boundaries. No raw-value cache. */
export function fingerprint(key: ComparisonKey, name: string, value: string | undefined): SafeValue {
  if (value === undefined) return { state: 'missing' };
  const digest = createHmac('sha256', Buffer.from(key.secret, 'hex'))
    .update('configtrace:value:v1\0').update(String(Buffer.byteLength(name))).update(':')
    .update(name).update(':').update(value).digest('hex');
  return { state: 'present', token: digest };
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
  constructor(public readonly patterns: string[], public readonly insensitive: boolean) {
    this.regex = patterns.map(p => globToRegex(p, insensitive));
  }
  canonical(key: string): string { return this.insensitive ? key.toUpperCase() : key; }
  matches(key: unknown): key is string {
    return typeof key === 'string' && key.length <= 128 && !key.toUpperCase().startsWith('__CONFIGTRACE_') && this.regex.some(r => r.test(key));
  }
  exact(): string[] { return this.patterns.filter(p => !/[*?]/.test(p)).map(k => this.canonical(k)); }
}

/** Metadata is minimized, not magically anonymized. Export can remove remaining project names. */
export class PathScrubber {
  constructor(private readonly root: string, private readonly salt: string) {}
  scrub(input: string): string {
    let file = input;
    try { if (file.startsWith('file://')) file = fileURLToPath(file); } catch { return '<unresolved>'; }
    file = file.split('?')[0].split('#')[0];
    if (file.startsWith('node:') || file.startsWith('<')) return file.slice(0, 256);
    const absolute = path.resolve(this.root, file);
    const relative = path.relative(this.root, absolute);
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/').slice(0, 512);
    }
    if (!relative) return '.';
    return `<external:${createHmac('sha256', this.salt).update(absolute).digest('hex').slice(0, 12)}>`;
  }
}
