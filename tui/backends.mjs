import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { controlHello, requestControl } from './pty-control.mjs';
import { startPane } from '../runtimes/tui/hc.mjs';

export function hcBackend({ command = 'hc' } = {}) {
  return {
    async launch({ cwd, argv, env, unset, name, provider }) {
      const pane = await startPane(command, cwd, argv, { env, unset, name, provider });
      return {
        id: pane.address,
        warnings: pane.warnings,
        async read() {
          const state = await pane.status();
          if (state.state === 'finished') return { exited: true, code: state.exitCode ?? state.exit_code, reason: state.reason };
          const { text } = await pane.screen();
          return { text, state: state.status?.state ?? state.status, agent: state.status?.app, writable: state.state === 'live' };
        },
        get status() { return pane.status; },
        close: () => pane.kill(),
      };
    },
  };
}

const wrapper = fileURLToPath(new URL('./loom-pty', import.meta.url));

export function hcWrappedBackend({ command = 'hc', modules } = {}) {
  return {
    async launch({ cwd, argv, env, unset, name, provider, evidence, sessionDir, socket = join(sessionDir, 'pty.sock') }) {
      const wrapEnv = {
        ...env,
        LOOM_PTY_SOCKET: socket,
        LOOM_PTY_PROVIDER: provider,
        LOOM_PTY_CLI: argv[0],
        LOOM_PTY_EVIDENCE: JSON.stringify(evidence),
        ...(modules ? { LOOM_PTY_MODULES: modules } : {}),
      };
      const pane = await startPane(command, cwd, [wrapper, ...argv], {
        env: wrapEnv, unset, name, provider, nativeCommand: argv[0],
      });
      const request = (method, params) => requestControl(socket, method, params, evidence.incarnation);
      async function readExit() {
        const state = await pane.status();
        if (state.state !== 'finished') return null;
        const code = state.exit_code ?? state.exitCode;
        let reason = state.reason;
        if (evidence.exitPath) {
          try {
            const child = JSON.parse(await readFile(evidence.exitPath, 'utf8'));
            if (child.incarnation === evidence.incarnation && child.code === code) reason = child.reason ?? reason;
          } catch { /* A killed wrapper or older process may leave only the hc exit result. */ }
        }
        return {
          phase: 'exited', source: 'host', ready: false,
          exit: { code, reason },
          screen: { kind: 'unavailable' },
        };
      }
      return {
        id: pane.address,
        status: pane.status,
        close: () => pane.kill(),
        remote: {
          warnings: pane.warnings,
          hello: () => controlHello(socket, evidence.incarnation),
          async readState() {
            let failure;
            const deadline = performance.now() + 2_500;
            do {
              try { return await request('state'); }
              catch (error) {
                if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'CONTROL_EOF'].includes(error.code)) throw error;
                failure = error;
              }
              const exit = await readExit();
              if (exit) return exit;
              await sleep(50);
            } while (performance.now() < deadline);
            throw failure;
          },
          submit: params => request('submit', params),
          interrupt: params => request('interrupt', params),
          dialog: params => request('dialog', params),
          confirmations: id => request('confirmations', { id }),
          async waitExit({ timeoutMs = 5_000 } = {}) {
            const deadline = performance.now() + timeoutMs;
            do {
              const result = await readExit();
              if (result) return result;
              await sleep(100);
            } while (performance.now() < deadline);
            return { phase: 'unknown', source: 'host', ready: false };
          },
        },
      };
    },
  };
}
