import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkHolder } from '../holder/assets.mjs';
import { holderError, idBytes } from '../holder/protocol.mjs';

export const holderAbsent = error => ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'HOLDER_EOF'].includes(error.code);
const transactionId = transaction => idBytes(transaction).toString('hex');

export function verifyHolderBuild(binding, snapshot, save) {
  const pending = binding.holderPending;
  if (pending && snapshot.transaction === transactionId(pending.transaction) && snapshot.build === pending.build.digest) {
    binding.previousHolderRelease = binding.holderRelease;
    binding.holderRelease = pending.build;
    delete binding.holderPending;
    save();
  } else if (snapshot.build !== binding.holderRelease.digest) throw holderError('HOLDER_BUILD');
}

export async function switchHolder({ addr, binding, client, save, target, rollback, check, verify, dead, pipes = false }) {
  const before = await client.hello();
  await verify(before);
  verifyHolderBuild(binding, before, save);
  const root = rollback ? binding.previousHolderRelease?.root : target;
  if (!root || root === binding.holderRelease.root) throw holderError('HOLDER_RELEASE', 'Choose a different holder release');
  const asset = await checkHolder(root, { pipes });
  if (rollback && asset.digest !== binding.previousHolderRelease.digest) throw holderError('HOLDER_BUILD');
  const build = { root, digest: asset.digest };
  if (check) return { addr, current: binding.holderRelease, target: build, eligible: true };

  const transaction = randomUUID();
  binding.holderPending = { transaction, build };
  save();
  try { await client.handoff(before.generation, transaction, asset); }
  catch (error) {
    if (!holderAbsent(error) && error.code !== 'HOLDER_TIMEOUT') {
      delete binding.holderPending;
      save();
      throw error;
    }
  }

  const deadline = performance.now() + 7000;
  do {
    const after = await client.hello().catch(error => {
      if (!holderAbsent(error)) throw error;
    });
    if (after?.transaction === transactionId(transaction)) {
      if (after.generation !== before.generation + 1n || after.pid !== before.pid || after.childPid !== before.childPid ||
          after.build !== asset.digest || after.ended || after.gap) throw holderError('HOLDER_IDENTITY');
      await verify(after);
      verifyHolderBuild(binding, after, save);
      return { addr, pid: after.pid, childPid: after.childPid, generation: String(after.generation), current: build };
    }
    if (await dead()) break;
    await delay(50);
  } while (performance.now() < deadline);
  throw holderError('HOLDER_NOT_READY', 'Holder candidate did not become READY');
}
