import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export function jsonlTail() {
  let offset = 0;
  let identity;
  let partial = '';
  let decoder = new StringDecoder('utf8');

  return async (path, skipExisting = false) => {
    if (!path) return [];
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (!file) return [];
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Claude evidence path is not a regular file');
      const current = `${stat.dev}:${stat.ino}`;
      if (current !== identity || stat.size < offset) {
        identity = current;
        offset = 0;
        partial = '';
        decoder = new StringDecoder('utf8');
      }
      if (skipExisting) offset = stat.size;
      if (offset >= stat.size) return [];
      const rows = [];
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (offset < stat.size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
        if (!bytesRead) break;
        offset += bytesRead;
        const lines = (partial + decoder.write(buffer.subarray(0, bytesRead))).split('\n');
        partial = lines.pop();
        for (const line of lines) {
          try {
            const value = JSON.parse(line);
            if (value && typeof value === 'object' && !Array.isArray(value)) rows.push(value);
          } catch {
            // A damaged complete line does not hide subsequent native evidence.
          }
        }
      }
      return rows;
    } finally {
      await file.close();
    }
  };
}
