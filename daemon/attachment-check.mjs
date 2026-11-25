import { join } from 'node:path';
import { inDirectory, runtimeDirectory } from '../cli/project.mjs';
import { holderClient, holderError } from '../holder/protocol.mjs';
import { controlHello } from '../tui/pty-control.mjs';
import { holderTerminal } from '../tui/holder-terminal.mjs';
import { nativeState } from '../tui/native.mjs';
import { providers } from '../tui/providers.mjs';
import { replayPipe, verifyPipeWatermark } from './codex-pipe-rpc.mjs';
import { hostDirectory, hostHello, hostRequest, hostSocket, hostUUID, readJSON } from './host-control.mjs';
import { verifyHolderBuild } from './native-holder.mjs';
import { processTable, sameProcess } from './processes.mjs';
import { ownedPane } from './tui.mjs';

export async function probeAttachments(project, sessions) {
  const processes = processTable();
  return Promise.all(sessions.map(async expected => {
    const { addr, backend, sessionId, pane } = expected;
    try {
      if (!hostUUID.test(addr.slice(backend === 'headless' ? 4 : 5)) ||
          !addr.startsWith(backend === 'headless' ? 'oar-' : 'loom-')) throw new Error('Invalid session address');
      const job = readJSON(join(runtimeDirectory(project), 'sessions', addr + '.json'));
      if (job?.row?.addr !== addr || job.row.backend !== backend || !inDirectory(project, job.row.cwd)) {
        throw new Error('Session has no project ownership record');
      }
      const row = { ...job.row, pane, sessionId };
      let observed;
      if (backend === 'headless') {
        const binding = job.host;
        if (!hostUUID.test(binding?.incarnation)) throw new Error('Invalid stored session host incarnation');
        const { incarnation } = binding;
        const dir = hostDirectory(project, addr, incarnation);
        const socket = hostSocket(project, addr, incarnation);
        if (binding.transport === 'holder-pipes') {
          const client = holderClient({ socket, incarnation });
          const state = readJSON(join(dir, 'rpc.json'));
          const snapshot = await client.snapshot();
          const holder = processes.get(snapshot.pid), child = processes.get(snapshot.childPid);
          if (!snapshot.pipes || snapshot.pid !== binding.identity?.pid || !holder ||
              holder.started !== binding.identity.started || holder.uid !== process.getuid() ||
              snapshot.childPid !== binding.childPid || !snapshot.ended && (child?.ppid !== holder.pid || child.uid !== holder.uid) ||
              state?.version !== 1 || state.incarnation !== incarnation) throw holderError('HOLDER_IDENTITY');
          verifyHolderBuild(binding, snapshot, () => {});
          while (BigInt(state.rpc.seq) < snapshot.eventSeq) {
            const batch = (await client.read(BigInt(state.rpc.seq))).filter(event => event.seq <= snapshot.eventSeq);
            if (!batch.length) throw holderError('HOLDER_GAP');
            replayPipe(state.rpc, batch, () => {}, () => {});
          }
          verifyPipeWatermark(state.rpc, snapshot);
          observed = { incarnation, pid: snapshot.pid, childPid: snapshot.childPid, protocol: 3,
            streamId: state.streamId, sessionId: state.threadId };
          if (snapshot.ended) return { ...expected, ...observed, status: 'ended' };
        } else {
          const ended = readJSON(join(dir, 'ended.json'));
          if (ended?.at && ended.sessionId === sessionId && incarnation === expected.incarnation) {
            return { ...expected, status: 'ended', endedAt: ended.at };
          }
          const { protocol } = await hostHello(socket, incarnation);
          const host = await hostRequest(socket, incarnation, 'state', undefined, protocol);
          if (host.project !== project || host.addr !== addr || host.incarnation !== incarnation ||
              host.root !== binding.root || host.release !== binding.release ||
              !sameProcess(host.identity, processes.get(host.identity?.pid))) throw new Error('Session host identity changed');
          if (host.error) throw new Error(host.error);
          observed = { incarnation, protocol, pid: host.identity.pid, sessionId: host.sessionId, streamId: host.streamId };
          if (host.endedAt != null) return { ...expected, ...observed, status: 'ended', endedAt: host.endedAt };
        }
      } else {
        const terminal = await ownedPane(job, row);
        if (!terminal) throw new Error('Owned pane is unavailable');
        const binding = job.tui;
        observed = { pane, pid: terminal.pid, incarnation: binding?.incarnation, protocol: null };
        if (terminal.state === 'finished') return { ...expected, ...observed, status: 'ended', endedAt: terminal.finished_ms };
        if (binding?.transport === 'holder-v3') {
          if (binding.evidence?.cwd !== row.cwd) throw holderError('HOLDER_IDENTITY');
          const view = await holderTerminal(binding, undefined, row.cli, terminal.pid, binding.childPid);
          try {
            verifyHolderBuild(binding, view.initial, () => {});
            const native = await nativeState(providers[row.cli], { ...binding.evidence,
              sessionId: sessionId ?? binding.evidence.sessionId }).read();
            if (native.identityChanged || view.initial.ended) throw holderError('HOLDER_IDENTITY');
            Object.assign(observed, { protocol: 3, childPid: view.initial.childPid, paneCreatedAt: terminal.created_ms,
              sessionId: native.sessionId ?? null });
          } finally { view.dispose(); }
        } else if (binding?.transport === 'loom-pty') {
          ({ protocol: observed.protocol } = await controlHello(binding.socket, binding.incarnation));
        }
      }
      return { ...expected, ...observed, status: 'attached' };
    } catch (error) {
      return { ...expected, status: 'unavailable', reason: error.message };
    }
  }));
}
