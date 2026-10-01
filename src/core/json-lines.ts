import fs from 'node:fs';
import { UserError } from './io';

export class AggregateReadLimit extends UserError {
  constructor() { super('Recorder streams exceed the aggregate input limit.', 65); }
}
export interface LineReadOptions {
  maxBytes: number;
  remainingBytes?: number;
  /** Called after the descriptor is checked, before any line is returned. */
  onSize?: (bytes: number) => void;
}

/**
 * Incremental UTF-8 lines from one regular, non-symlink file. A character may cross
 * a chunk boundary. Memory: one 64 KiB chunk plus the longest (bounded) record.
 * A final non-newline-terminated line is returned, preserving the old collector.
 * Consumers must exhaust the iterator for final mutation checks; early return
 * still closes the descriptor. Never include file data in errors.
 */
export function* readLinesBounded(file: string, options: LineReadOptions): Generator<string> {
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(file);
    if (before.isSymbolicLink()) throw new UserError('Symbolic-link inputs are not accepted.', 65);
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const initial = fs.fstatSync(fd);
    if (!initial.isFile() || initial.size > options.maxBytes || initial.ino !== before.ino || initial.dev !== before.dev)
      throw new UserError('Input is not a regular file, changed, or exceeds its size limit.', 65);
    if (initial.size > (options.remainingBytes ?? Number.POSITIVE_INFINITY)) throw new AggregateReadLimit();
    options.onSize?.(initial.size);
    let total = 0;
    let pending: Buffer[] = [];
    let pendingSize = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, initial.size - total + 1));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      total += count;
      if (total > initial.size || total > options.maxBytes) throw new UserError('Input changed while being read or exceeds its size limit.', 65);
      let start = 0;
      let end: number;
      while ((end = chunk.indexOf(10, start)) >= 0 && end < count) {
        const part = chunk.subarray(start, end);
        if (pending.length) {
          pending.push(part);
          const line = Buffer.concat(pending, pendingSize + part.length).toString('utf8');
          pending = []; pendingSize = 0;
          yield line;
        } else yield part.toString('utf8');
        start = end + 1;
      }
      if (start < count) {
        const tail = chunk.subarray(start, count);
        pending.push(tail); pendingSize += tail.length;
      }
    }
    const final = fs.fstatSync(fd);
    if (total !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs)
      throw new UserError('Input changed while being read.', 65);
    if (pending.length) yield Buffer.concat(pending, pendingSize).toString('utf8');
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Unable to read recorder stream. Check its path and permissions.', 74);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
