import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { receipt, stalledDelivery, stallText } from '../inbox/engine.mjs';
import { deliveryFailed, messageIdPattern } from '../inbox/message.mjs';
import { lookup } from '../inbox/store.mjs';
import { addressPattern } from '../inbox/tui.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { managedProject, projectDirectory, projectReceipt } from './project.mjs';

export const sendUsage = 'loom send <target> [--mode queue|interrupt] [--from ADDR] [--project DIR] [--expect-reply|--wait] "<message>"';
export const sendHelp = '--from defaults to LOOM_ADDR. Use --expect-reply to request an inbox reply. --wait is for callers outside managed sessions.';
export const sendAdvancedHelp = 'Advanced options: --mode steer, --id UUID (idempotent request), --batch UUID --batch-size N (explicit Leader-to-worker continuation group).';
const legacy = fileURLToPath(new URL('../inbox/cli.mjs', import.meta.url));

async function waitForReply(project, response) {
  const deadline = Date.now() + 300_000;
  let current;
  do {
    current = lookup(project, response.id);
    if (current?.completion?.body || current?.completion?.noReply || deliveryFailed(current) || current && stalledDelivery(current)) break;
    await sleep(250);
  } while (Date.now() < deadline);
  const result = { ...response, ...(current && { ...receipt(current), phase: current.phase }) };
  if (current?.completion?.body) return { ...result, reply: current.completion.body };
  const code = current?.phase === 'corrupted' ? 'corrupted' :
    deliveryFailed(current) ? 'not-ready' : current?.completion ? 'unavailable' : 'uncertain';
  const stalled = current && stalledDelivery(current) &&
    stallText({ id: current.id, target: current.target.addr, reason: result.reason, ageMs: result.ageMs });
  return { ...result, ok: false, error: { code, message: stalled || current?.issue ||
    (current?.completion?.unconfirmed ? 'Native final reply is unconfirmed' :
      current?.completion ? 'No native final reply' : 'Still waiting for a reply') } };
}

export async function send(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      mode: { type: 'string', default: 'queue' }, from: { type: 'string' }, project: { type: 'string' },
      id: { type: 'string' }, batch: { type: 'string' }, 'batch-size': { type: 'string' },
      'expect-reply': { type: 'boolean' }, wait: { type: 'boolean' },
    } });
  } catch (error) {
    throw Object.assign(error, { code: 'invalid-arguments' });
  }
  const { values, positionals: [target, text] } = parsed;
  const { mode, id, batch, 'batch-size': size, 'expect-reply': expectReply, wait } = values;
  const from = values.from ?? (process.env.LOOM_ADDR || undefined);
  const invalid = message => { throw Object.assign(new Error(message), { code: 'invalid-arguments' }); };
  if (wait && process.env.LOOM_ADDR) {
    invalid('--wait is unavailable in a managed session. Use --expect-reply to request an inbox reply.');
  }
  if (parsed.positionals.length !== 2 || !addressPattern.test(target) ||
      from !== undefined && !addressPattern.test(from) || !['queue', 'steer', 'interrupt'].includes(mode) ||
      id !== undefined && !messageIdPattern.test(id) ||
      (batch !== undefined || size !== undefined) && (!messageIdPattern.test(batch ?? '') || !/^[1-9]\d*$/.test(size ?? '')) ||
      !text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) invalid(sendUsage);
  const project = projectDirectory(values.project);
  if (!managedProject(project)) {
    // Keep the unmanaged TUI transport available for existing registrations.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      'const { main } = await import(process.argv[1]); process.exitCode = await main(process.argv.slice(2));',
      legacy, '--project', project, '--mode', mode, ...(from ? ['--from', from] : []),
      ...(id ? ['--id', id] : []), ...(batch ? ['--batch', batch, '--batch-size', size] : []),
      ...(expectReply ? ['--expect-reply'] : []), ...(wait ? ['--wait'] : []), '--', target, text],
      { encoding: 'utf8', timeout: 20_000 });
    if (child.error) throw child.error;
    return { ...JSON.parse(child.stdout), ...projectReceipt(project) };
  }

  let response;
  try {
    response = await request(project, 'send', { target, mode, from, text, id, batch, expectReply,
      batchSize: size === undefined ? undefined : Number(size) });
  } catch (error) {
    if (daemonAbsent(error)) throw Object.assign(new Error('loomd is not running for this project'), { code: 'not-ready' });
    throw error;
  }
  return { ...(wait ? await waitForReply(project, response) : response), ...projectReceipt(project) };
}
