import { join } from 'node:path';
import { combinedDeliveryText } from '../inbox/message.mjs';
import { readJSON } from './host-control.mjs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkHolder } from '../holder/assets.mjs';
import { holderError, idBytes } from '../holder/protocol.mjs';
import { bindTuiSession } from '../tui/index.mjs';
import { holderTerminal } from '../tui/holder-terminal.mjs';
import { providers } from '../tui/providers.mjs';

const absent = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'HOLDER_EOF']);

export function tuiHolders(project, controller, save) {
  const attached = new Map();

  function verifyBuild(job, snapshot) {
    const binding = job.tui;
    const pending = binding.holderPending;
    if (pending && snapshot.transaction === idBytes(pending.transaction).toString('hex') && snapshot.build === pending.build.digest) {
      binding.previousHolderRelease = binding.holderRelease;
      binding.holderRelease = pending.build;
      delete binding.holderPending;
      save(job);
    } else if (snapshot.build !== binding.holderRelease.digest) throw holderError('HOLDER_BUILD');
  }

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
      verifyBuild(job, terminal.initial);
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
    const before = await terminal.client.hello();
    verifyBuild(job, before);
    const root = rollback ? binding.previousHolderRelease?.root : target;
    if (!root || root === binding.holderRelease.root) throw holderError('HOLDER_RELEASE', 'Choose a different holder release');
    const asset = await checkHolder(root);
    if (rollback && asset.digest !== binding.previousHolderRelease.digest) throw holderError('HOLDER_BUILD');
    const build = { root, digest: asset.digest };
    if (check) return { addr: row.addr, current: binding.holderRelease, target: build, eligible: true };
    const transaction = randomUUID();
    binding.holderPending = { transaction, build };
    save(job);
    try {
      await terminal.client.handoff(before.generation, transaction, asset);
    } catch (error) {
      if (!absent.has(error.code)) {
        delete binding.holderPending;
        save(job);
        throw error;
      }
    }
    const deadline = performance.now() + 7000;
    do {
      const after = await terminal.client.hello().catch(error => {
        if (!absent.has(error.code)) throw error;
      });
      if (after?.transaction === idBytes(transaction).toString('hex')) {
        const current = await status();
        if (after.generation !== before.generation + 1n || after.pid !== before.pid || after.childPid !== before.childPid ||
            after.build !== asset.digest || current.pid !== pane.pid || current.created_ms !== pane.created_ms ||
            current.address !== pane.address || current.state !== 'live') throw holderError('HOLDER_IDENTITY');
        verifyBuild(job, after);
        await session.readState({ passive: true });
        return { addr: row.addr, pid: after.pid, childPid: after.childPid, generation: String(after.generation), current: build };
      }
      if ((await status())?.state === 'finished') break;
      await delay(50);
    } while (performance.now() < deadline);
    throw holderError('HOLDER_NOT_READY', 'Holder candidate did not become READY');
  }

  return {
    attach, detach, handoff,
    clear() {
      for (const value of attached.values()) value.terminal.dispose();
      attached.clear();
    },
  };
}
