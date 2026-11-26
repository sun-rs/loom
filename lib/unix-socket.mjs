import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

export function connectUnix(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('Expected an absolute Unix socket path');
  return createConnection(path);
}
