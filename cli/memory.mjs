import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { CommandError } from './sessions.mjs';

const nonempty = value => typeof value === 'string' && value.trim() !== '';
const invalid = () => new CommandError('invalid-arguments', 'Invalid loom mem arguments. See loom mem --help.');

export function validateMemoryCommand(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid();
  const { action, target, entry, requestId, expectedRevision } = args;
  if (['search', 'show'].includes(action)) {
    if (!nonempty(target) || [entry, requestId, expectedRevision].some(value => value !== undefined)) throw invalid();
    return;
  }
  if (!['write', 'update', 'invalidate'].includes(action) || !nonempty(requestId) ||
      (action === 'write' ? target !== undefined || expectedRevision !== null :
        !nonempty(target) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) ||
      (action === 'invalidate' ? entry !== undefined : !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw invalid();
  }
}

export async function memoryCommand(directory, positionals, values) {
  const [action, target] = positionals;
  if (positionals.length > 2) throw invalid();
  const revision = values['expected-revision'];
  let entry;
  if (values.entry !== undefined) {
    try { entry = JSON.parse(values.entry); }
    catch { throw invalid(); }
  }
  const args = { action, target, entry, requestId: values['request-id'], expectedRevision:
    revision === undefined ? undefined : revision === 'null' ? null : /^[0-9]+$/.test(revision) ? Number(revision) : NaN };
  validateMemoryCommand(args);
  try { return await request(directory, 'mem', args); }
  catch (error) {
    if (daemonAbsent(error)) throw new CommandError('not-ready', 'loomd must be running to access memory');
    if (error instanceof CommandError) throw error;
    throw new CommandError('unavailable', 'Project memory is unavailable');
  }
}
