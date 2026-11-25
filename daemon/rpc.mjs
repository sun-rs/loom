import { createConnection } from 'node:net';
import { callerAddress, socketPath } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';

export const maxLine = 1024 * 1024;
export const daemonAbsent = error => ['ENOENT', 'ECONNREFUSED'].includes(error.code);

export async function request(project, command, args = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath(project));
    let body = '';
    socket.setEncoding('utf8');
    const timeout = command === 'spawn' ? 180_000 : ['upgrade-plan', 'upgrade-apply'].includes(command) ? 60_000 : 30_000;
    socket.setTimeout(timeout);
    socket.once('connect', () => socket.write(JSON.stringify({
      command, args, caller: callerAddress(), protocol: 1,
    }) + '\n'));
    socket.on('data', chunk => { body += chunk; });
    socket.once('error', reject);
    socket.once('timeout', () => socket.destroy(new CommandError('uncertain', 'Timed out waiting for loomd')));
    socket.once('end', () => {
      try {
        const response = JSON.parse(body);
        if (response.ok) resolve(response);
        else reject(new CommandError(response.error.code, response.error.message));
      } catch (error) { reject(error); }
    });
  });
}
