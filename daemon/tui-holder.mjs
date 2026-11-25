import { holderError } from '../holder/protocol.mjs';
import { join } from 'node:path';
import { combinedDeliveryText } from '../inbox/message.mjs';
import { bindTuiSession } from '../tui/index.mjs';
import { holderTerminal } from '../tui/holder-terminal.mjs';
import { providers } from '../tui/providers.mjs';

import { switchHolder, verifyHolderBuild } from './native-holder.mjs';
import { readJSON } from './host-control.mjs';

export function tuiHolders(project, controller, save) {
  const attached = new Map();

  async function attach(job, row, pane) {
    const binding = job.tui;
    const existing = attached.get(binding.incarnation);
    if (existing) {
      if (existing.terminal.initial.pid !== pane.pid || existing.terminal.initial.childPid !== binding.childPid) {
        throw holderError('HOLDER_IDENTITY');
      }
      return existing;
    }
    if (!controller || !binding.evidence || binding.evidence.cwd !== row.cwd) throw holderError('HOLDER_CONTROLLER');
    const terminal = await holderTerminal(binding, controller, row.cli, pane.pid, binding.childPid);
    const session = bindTuiSession(terminal, providers[row.cli], {
      ...binding.evidence, sessionId: row.sessionId ?? binding.evidence.sessionId,
      readPending(id) {
        const { messages } = readJSON(join(project, '.project', 'inbox', 'state.json'), { messages: [] });
        const message = messages.find(message => message.id === id && message.target.addr === row.addr &&
          message.phase === 'sending' && !message.received);
        if (!message) return;
        const waves = (message.combinedWaves ?? []).map(waveId => messages.find(wave => wave.id === waveId && wave.combinedInto === id));
        if (!waves.some(wave => !wave)) return { ...message, text: combinedDeliveryText(message, waves) };
      },
    });
    try {
      verifyHolderBuild(binding, terminal.initial, () => save(job));
      const state = await session.readState({ passive: true });
      if (state.exit || state.native.identityChanged || row.sessionId && state.native.sessionId !== row.sessionId) {
        throw holderError('HOLDER_IDENTITY');
      }
      if (!binding.childPid) {
        binding.childPid = terminal.initial.childPid;
        save(job);
      }
      const entry = { terminal, session };
      attached.set(binding.incarnation, entry);
      return entry;
    } catch (error) {
      terminal.dispose();
      throw error;
    }
  }

  function detach(binding) {
    attached.get(binding?.incarnation)?.terminal.dispose();
    attached.delete(binding?.incarnation);
  }

  async function handoff(job, row, pane, status, target, rollback, check) {
    const binding = job.tui;
    const { terminal, session } = await attach(job, row, pane);
    const result = await switchHolder({ addr: row.addr, binding, client: terminal.client, save: () => save(job),
      target, rollback, check, dead: async () => (await status())?.state === 'finished',
      async verify(value) {
        const current = await status();
        if (!current || current.pid !== pane.pid || current.created_ms !== pane.created_ms ||
            current.address !== pane.address || current.state !== 'live' || value.pid !== pane.pid ||
            value.childPid !== terminal.initial.childPid) throw holderError('HOLDER_IDENTITY');
      },
    });
    if (!check) await session.readState({ passive: true });
    return result;
  }

  return {
    attach, detach, handoff,
    clear() {
      for (const value of attached.values()) value.terminal.dispose();
      attached.clear();
    },
  };
}
