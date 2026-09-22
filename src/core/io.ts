import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { TraceSchema, MAX_ARTIFACT_BYTES, type Trace } from './schema';

export class UserError extends Error {
  constructor(message: string, public readonly exitCode = 64) { super(message); this.name = 'UserError'; }
}

/** Never include arbitrary fs/parser messages: they can contain credentials or file contents. */
export function readBounded(file: string, max = MAX_ARTIFACT_BYTES): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new UserError('Input is not a regular file or exceeds its size limit.', 65);
    const buffer = Buffer.alloc(Math.min(max + 1, stat.size + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const n = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (n === 0) break;
      offset += n;
    }
    if (offset > max || offset > stat.size) throw new UserError('Input changed while being read or exceeds its size limit.', 65);
    return buffer.subarray(0, offset).toString('utf8');
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Unable to read input. Check its path and permissions.', 74);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Exclusive creation, restrictive permissions, no overwrite of a file or symlink. */
export function writeNew(file: string, data: string): void {
  let fd: number | undefined;
  try {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, data, 'utf8');
  } catch {
    throw new UserError('Unable to create output. It may already exist or the directory is not writable.', 74);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function readTrace(file: string): Trace {
  try { return TraceSchema.parse(JSON.parse(readBounded(file))); }
  catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid, oversized, or unsupported ConfigTrace artifact.', 65);
  }
}
export function writeTrace(file: string, trace: Trace): void {
  const checked = TraceSchema.safeParse(trace);
  if (!checked.success) throw new UserError('Refusing to write an invalid trace artifact.', 74);
  const data = JSON.stringify(checked.data, null, 2) + '\n';
  if (Buffer.byteLength(data) > MAX_ARTIFACT_BYTES) throw new UserError('Artifact exceeds the output size limit.', 74);
  writeNew(file, data);
}
export function uniqueId(prefix = 'r'): string { return `${prefix}_${randomBytes(12).toString('hex')}`; }
export function terminalSafe(input: string, multiline = false): string {
  const controls = multiline
    ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
    : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
  return input.replace(controls, '?');
}
