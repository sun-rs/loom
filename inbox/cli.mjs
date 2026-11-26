import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { receipt } from './engine.mjs';
import { lookup } from './store.mjs';
import { deliveryFailed, messageIdPattern } from './message.mjs';
import { addressPattern } from './tui.mjs';
import { managedProject, projectDirectory } from '../cli/project.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';

const usage = 'Usage: loom send <target> [--mode queue|steer|interrupt] [--from <addr>] [--project <dir>] [--id UUID] [--batch UUID --batch-size N] [--expect-reply|--wait] "<msg>"';

const emit = value => console.log(JSON.stringify(value));

function fail(code, message, exit) {
  emit({ ok: false, error: { code, message } });
  return exit;
}

export async function main(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args, allowPositionals: true,
      options: { mode: { type: 'string', default: 'queue' }, from: { type: 'string' },
        project: { type: 'string' }, id: { type: 'string' }, batch: { type: 'string' }, 'batch-size': { type: 'string' },
        'expect-reply': { type: 'boolean' }, wait: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (error) {
    return fail('invalid-arguments', error.message, 2);
  }
  const { values: { mode: requestedMode, from, project: projectArg, id, batch, 'batch-size': size, help, wait }, positionals } = parsed;
  if (help) { console.log(usage); return 0; }
  const [targetArg, text] = positionals;
  if (positionals.length !== 2 || !addressPattern.test(targetArg) ||
      (from !== undefined && !addressPattern.test(from)) || !['queue', 'steer', 'interrupt'].includes(requestedMode) ||
      (id !== undefined && !messageIdPattern.test(id)) ||
      ((batch !== undefined || size !== undefined) && (!messageIdPattern.test(batch) || !/^[1-9]\d*$/.test(size))) ||
      !text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) {
    return fail('invalid-arguments', usage, 2);
  }
  try {
    const managed = projectDirectory(projectArg);
    if (managedProject(managed)) {
      const response = await request(managed, 'send', { target: targetArg, mode: requestedMode, from, text,
        id, batch, expectReply: parsed.values['expect-reply'], batchSize: size === undefined ? undefined : Number(size) });
      if (wait) {
        const deadline = Date.now() + 300_000;
        let current;
        do {
          current = lookup(managed, response.id);
          if (current?.completion?.body || current?.completion?.noReply || deliveryFailed(current)) break;
          await sleep(250);
        } while (Date.now() < deadline);
        if (current?.completion?.body) {
          emit({ ...response, ...receipt(current), phase: current.phase, reply: current.completion.body });
          return 0;
        }
        const code = deliveryFailed(current) ? 'not-ready' : current?.completion ? 'unavailable' : 'uncertain';
        emit({ ...response, ...(current && { ...receipt(current), phase: current.phase }), ok: false,
          error: { code, message: current?.issue ?? (current?.completion?.unconfirmed ? 'Native final reply is unconfirmed' :
            current?.completion ? 'No native final reply' : 'Still waiting for a reply') } });
        return 1;
      }
      emit(response);
      return 0;
    }
    return fail('unsupported', 'TUI delivery requires a daemon-managed loom-pty session', 1);
  } catch (error) {
    if (daemonAbsent(error) && error.syscall === 'connect') return fail('not-ready', 'loomd is not running for this project', 1);
    if (['invalid-arguments', 'not-found', 'ambiguous-target', 'not-ready', 'uncertain', 'unsupported', 'id-conflict', 'batch-closed'].includes(error.code)) {
      return fail(error.code, error.message, error.code === 'invalid-arguments' ? 2 : ['not-found', 'ambiguous-target'].includes(error.code) ? 3 : 1);
    }
    if (error.kind === 'not_found' || error.kind === 'ambiguous-target') {
      return fail(error.kind.replace('_', '-'), error.message, 3);
    }
    return fail('unavailable', error.message, 1);
  }
}
