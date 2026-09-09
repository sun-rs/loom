/**
 * Raft addresses a Task the way a Human reads it in the Room:
 * `raft task claim --target "#channel" --number 1 --number 2`
 * (agent-prompt-compiler.js line 181), with `--channel` kept as the legacy
 * alias and `--number` repeatable on `claim` alone
 * (`agentApiTaskClaimBodySchema = { channel, task_numbers }`).
 *
 * RAH keeps `--task-id ID` as well: the canonical Task id is what its Human
 * client and its Kernel already address, and the server resolves either form to
 * the same Task before any authority check runs.
 */
export const TASK_ADDRESS_OPTIONS = [
  "channel",
  "number",
  "target",
  "task-id",
] as const;

/** How `parseOptions` records a repeated flag; no CLI value may contain it. */
export const REPEATED_VALUE_SEPARATOR = "\u001f";

const ADDRESS_USAGE =
  'address the Task with --target "#channel" --number N, or with --task-id ID';

function channelOf(
  options: Readonly<Record<string, string>>,
): string | undefined {
  if (options.target !== undefined && options.channel !== undefined)
    throw new Error("choose --target or --channel");
  const channel = options.target ?? options.channel;
  if (channel === undefined) return undefined;
  if (channel.length === 0 || channel.length > 500)
    throw new Error("--target must be a non-empty bounded value");
  return channel;
}

function taskNumber(raw: string): number {
  if (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new Error(`--number must be a positive integer; got ${raw}`);
  return Number(raw);
}

function taskId(options: Readonly<Record<string, string>>): string {
  const value = options["task-id"]!;
  if (value.length === 0 || value.includes("\0") || value.length > 512)
    throw new Error("--task-id must be a non-empty bounded value");
  return value;
}

/** One Task: `{ taskId }` or `{ channel, taskNumber }`, never both. */
export function taskAddress(
  options: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const channel = channelOf(options);
  const number = options.number;
  if (options["task-id"] !== undefined) {
    if (channel !== undefined || number !== undefined)
      throw new Error("choose --task-id or --target with --number");
    return { taskId: taskId(options) };
  }
  if (channel === undefined || number === undefined)
    throw new Error(ADDRESS_USAGE);
  return { channel, taskNumber: taskNumber(number) };
}

/** `task-claim` alone: `--number` is repeatable upstream. */
export function taskAddressList(
  options: Readonly<Record<string, string>>,
): Record<string, unknown>[] {
  const channel = channelOf(options);
  const numbers = options.number;
  if (options["task-id"] !== undefined) {
    if (channel !== undefined || numbers !== undefined)
      throw new Error("choose --task-id or --target with --number");
    return [{ taskId: taskId(options) }];
  }
  if (channel === undefined || numbers === undefined)
    throw new Error(ADDRESS_USAGE);
  return numbers
    .split(REPEATED_VALUE_SEPARATOR)
    .map((raw) => ({ channel, taskNumber: taskNumber(raw) }));
}
