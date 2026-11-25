import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const project = process.env.LOOM_FAULT_PROJECT;
if (project && process.argv[1]?.endsWith('/daemon/session-host.mjs')) {
  const arm = join(project, 'fault.json');
  const events = join(project, '.project/relay/events') + '/';
  const append = fs.appendFileSync;
  fs.appendFileSync = (path, data, options) => {
    if (typeof path !== 'string' || !path.startsWith(events) ||
        typeof data !== 'string') return append(path, data, options);
    let fault;
    try { fault = JSON.parse(fs.readFileSync(arm, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return append(path, data, options);
    }
    if (JSON.parse(data).type !== fault.stage) return append(path, data, options);
    function killDaemon() {
      const lock = fs.readdirSync(join(project, '.project/relay/lock'));
      if (lock.length !== 1 || !/^\d+-\.lock-/.test(lock[0])) throw new Error('No test daemon lock owner');
      fs.writeFileSync(join(project, 'fault-fired.json'), JSON.stringify(fault) + '\n', { flush: true });
      fs.unlinkSync(arm);
      process.kill(Number(lock[0].split('-', 1)[0]), 'SIGKILL');
    }
    if (fault.moment === 'before') killDaemon();
    const written = append(path, data, options);
    if (fault.moment === 'after') killDaemon();
    return written;
  };
  syncBuiltinESMExports();
}
