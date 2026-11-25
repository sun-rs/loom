import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const role = fileURLToPath(new URL('./hc-role.mjs', import.meta.url));
const paneName = addr => 'lh-' + addr.slice(5, 20).replaceAll('-', '');

export async function hc(command, ...args) {
  try {
    const { stdout } = await exec('hc', [command, '--json', ...args], { timeout: 10_000 });
    return JSON.parse(stdout);
  } catch (error) {
    let kind;
    try { kind = JSON.parse(error.stderr).error.kind; } catch {}
    throw Object.assign(error, { kind });
  }
}

export const realHc = {
  async openPane(job, row, project) {
    const started = await hc('run', '--bg', '--no-parent', '--no-notify', '--name', paneName(row.addr), '--cwd', project,
      '--', process.execPath, role, project, row.addr, randomUUID());
    return { terminal: await hc('get', started.address) };
  },
  async getPane(job, row) {
    return hc('get', row.pane ?? paneName(row.addr)).catch(error => {
      if (error.kind !== 'not_found') throw error;
    });
  },
  async callHc(command, addr, ...args) {
    if (command === 'get') {
      const terminal = await hc(command, addr);
      return { ...terminal, status: { state: 'idle' } };
    }
    // The fixture is an idle line reader and does not emit a vendor status badge.
    if (command === 'send') return hc(command, addr, args[0]);
    return hc(command, addr, ...args);
  },
};
