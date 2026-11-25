import { decode } from '../lib/turn-tools.mjs';
export { decode, turnTools } from '../lib/turn-tools.mjs';

export const timestamp = value => typeof value === 'number' ? value : Date.parse(value ?? '');

const starts = {
  codex: row => ['task_started', 'turn_started', 'user_message'].includes(row.payload?.type) ||
    row.type === 'response_item' && row.payload?.role === 'user',
  claude: row => row.type === 'user' && !row.isMeta && !row.isCompactSummary && !row.isVisibleInTranscriptOnly &&
    !row.isSidechain && row.parent_tool_use_id == null && row.parentToolUseId == null &&
    (typeof row.message?.content === 'string' || Array.isArray(row.message?.content) &&
      row.message.content.some(block => block.type === 'text')),
  agy: row => ['USER_EXPLICIT', 'USER'].includes(row.source) && ['USER_INPUT', 'REQUEST'].includes(row.type),
  opencode: row => row.type === 'turn-start' || row.hook_event_name === 'UserPromptSubmit',
};

const nativeId = row => row.payload?.turn_id ?? row.payload?.id ?? row.uuid ?? row.step_index ?? row.turnId ?? row.turn_id;
const timeOf = row => timestamp(row.timestamp ?? row.created_at ?? row.receivedAt ?? row.at);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function transcriptRows(text) {
  return text.replace(/^\uFEFF/, '').split('\n').flatMap((line, i) => {
    const row = decode(line);
    return row && typeof row === 'object' ? [{ row, line, number: i + 1 }] : [];
  });
}

export function nativeRanges(rows, turns, provider) {
  const markers = rows.filter(({ row }) => starts[provider]?.(row));
  const offsets = [];
  let previous = 0;
  for (const turn of turns) {
    const at = timestamp(turn.startedAt);
    const candidates = markers.filter(record => record.number > previous);
    const marker = candidates.find(({ row }) => sameId(nativeId(row), turn.id) &&
      (!Number.isFinite(at) || !Number.isFinite(timeOf(row)) || timeOf(row) === at)) ??
      candidates.find(({ row }) => Number.isFinite(at) && timeOf(row) === at) ??
      (!Number.isFinite(at) && provider === 'codex' ? candidates.find(({ row }) =>
        ['task_started', 'turn_started'].includes(row.payload?.type) && nativeId(row) == null && turn.id == null) : undefined);
    if (marker) previous = marker.number;
    offsets.push(marker?.number ?? null);
  }
  return offsets.map((start, i) => {
    if (!start) return [];
    const next = offsets[i + 1];
    const end = next ? next - 1 : i === turns.length - 1 ? Infinity : start;
    const range = rows.filter(record => record.number >= start && record.number <= end);
    const endAt = timestamp(turns[i].endedAt);
    return Number.isFinite(endAt) ? range.filter(({ row }, index) =>
      index === 0 || !Number.isFinite(timeOf(row)) || timeOf(row) <= endAt) : range;
  });
}
