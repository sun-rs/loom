export const now = Date.parse('2026-11-26T14:00:00Z');
export const project = '/fixture/织布工程';
const ago = minutes => now - minutes * 60_000;
const iso = minutes => new Date(ago(-minutes)).toISOString();
const dir = role => project + '/' + role;
function quota(id, label, kind, usedPercent, windowMinutes, reset, { model, observed = -4 } = {}) {
  return { id, label, kind, model, usedPercent, windowMinutes, resetsAt: reset == null ? null : iso(reset),
    source: 'fixture', observedAt: iso(observed) };
}

export const accounts = { accounts: [
  { cli: 'codex', accountMasked: 'c***@example.test', plan: 'Pro', active: true, resetCredits: 3, expiresAt: iso(2880), windows: [
    quota('primary', '5h', '5h', 59, 300, 142),
    quota('secondary', '周', 'weekly', 41, 10080, 1085),
  ] },
  { cli: 'codex', accountMasked: 'd***@example.test', plan: 'Pro', active: false, resetCredits: 1, windows: [
    quota('secondary', '周', 'weekly', 12, 10080, 6000),
  ] },
  { cli: 'claude', accountMasked: 'm***@example.test', plan: 'Max 5x', active: true, windows: [
    quota('primary', '5h', '5h', 22, 300, 179),
    quota('fable', 'Fable 周', 'model', 96, 10080, 4185, { model: 'Fable' }),
  ] },
  { cli: 'agy', accountMasked: 'a***@example.test', plan: 'Google AI Ultra', active: true, windows: [
    quota('gemini-week', 'Gemini 周', 'model', 32, 10080, 4260, { model: 'Gemini' }),
    quota('gemini-5h', 'Gemini 5h', 'model', 66, 300, 212, { model: 'Gemini' }),
    quota('claude-gpt-week', 'Claude/GPT 周', 'model', 79, 10080, 2370, { model: 'Claude/GPT' }),
    quota('claude-gpt-5h', 'Claude/GPT 5h', 'model', 52, 300, -10, { model: 'Claude/GPT', observed: -183 }),
  ] },
  { cli: 'kimi', plan: 'Pro', active: false, windows: [] },
] };

export const board = {
  layout: { space: { name: '织布工程', id: 'space-ffeeddccbbaa' }, tabs: {
    leader: { id: 'herdr-tab-leader-12345', addr: '1234abcd-leader' },
    auditor: { id: 'herdr-tab-auditor-12345', addr: '9876dcba-auditor' },
  } },
  roles: [
    { role: 'leader', cli: 'codex', model: 'GPT-5.6', state: 'busy', addr: '1234abcd-leader', activityAt: ago(1),
      contextPercent: 38.4, sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: dir('leader'),
      transcriptPath: dir('leader/fixture.jsonl') },
    { role: 'auditor', cli: 'claude', model: 'Fable', state: 'idle', addr: '9876dcba-auditor', activityAt: ago(3),
      contextPercent: 52 },
  ],
  workers: [
    { task: '索引🧵校验与回放跨项目工作队列', wave: 'W-02', state: 'busy', cli: 'codex', addr: 'bead0001-worker', startedAt: ago(6) },
    { task: '👩🏽‍💻 快照核对 · 中文长标题与表格宽度验证', wave: 'W-02', state: 'starting', cli: 'agy', addr: 'bead0002-worker',
      startedAt: ago(0.2) },
    { task: 'Delivery retries and reconnect smoke test', wave: 'W-03', state: 'idle', cli: 'claude', addr: 'bead0003-worker',
      startedAt: ago(23) },
  ],
  delivery: { counts: { queued: 3, typed: 1, stalled: 1, refused: 0, 'awaiting-user': 0 }, oldestAgeMs: 420_000 },
  gates: [
    { id: 'GATE-042-smoke', phase: 'received', round: 2, completedAt: ago(6), packet: dir('gates/gate-042.md'),
      verdict: { tag: 'PASS', round: 2, line: '回归用例通过 ✅', text: 'PASS 回归用例通过 ✅\n完整门禁裁决第二行。' } },
    { id: 'GATE-043-rollout', phase: 'queued', round: 1 },
  ],
  notifications: { count: 3, last: [
    { id: 'notice-a', type: 'delivery-stalled', at: ago(7), text: '有一条投递等待重试 🧵' },
    { id: 'notice-b', type: 'consumption-pyramid', at: ago(6), text: 'Pyramid inverted' },
    { id: 'notice-c', type: 'senior-tool-output-share', at: ago(6), text: 'Tool output share warning' },
  ] },
  pyramids: [{ project, sampledAt: ago(1), state: 'inverted',
    byRole: { auditor: { rawTokens: 2100, modelCalls: 5 }, leader: { rawTokens: 4600, modelCalls: 2 },
      worker: { rawTokens: 2600, modelCalls: 1 } },
    inversions: [{ higher: 'auditor', lower: 'leader', metric: 'modelCalls' }],
  }],
  accounts,
  release: { id: 'cafe123456', root: '/fixture/releases/cafe123456', cli: '/fixture/bin/loom', warnings: [] },
};
