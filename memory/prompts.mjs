export const memoryWriteReminder = '如属持久规则，考虑写入记忆。';
const background = '背景笔记，仅供参考，使用前核验';
export const observationRules = [
  'Save facts that help future sessions:',
  'user — when you learn the user’s preferences or roles.',
  'feedback — when the user corrects or confirms a practice.',
  'project — when you learn lasting decisions, deadlines or constraints that cannot be inferred from code.',
  'reference — when you learn where to look up external information.',
  'Skip code structure, Git history, facts already documented in the repository, one-off progress and current conversation details.',
  'Use Why: for the reason and How to apply: for when and what to do. Search for duplicates before writing. Update existing entries when facts change and supersede or withdraw outdated entries.',
  '用户纠正/确认工作流程（feedback）存为 `lesson`，项目级红线/期限/决策（project）存为 `ruling`。',
].join('\n');

const storageGuidance = 'For direct writes, map user to preference, project to ruling, and feedback or reference to lesson. ' +
  'A candidate is a pending review record. Follow your role’s write permissions.';
const writeCommands = 'Search with loom mem search and inspect matches with loom mem show. ' +
  'Use loom mem write for new facts, loom mem update for revisions and loom mem invalidate for withdrawn guidance.';

export function memoryStartupPrompt(role, indexText) {
  const guidance = ['leader', 'auditor', 'super'].includes(role) ? [
    'Memory writing',
    observationRules,
    storageGuidance,
    writeCommands,
  ].join('\n') : '';
  return [guidance, indexText].filter(Boolean).join('\n\n');
}
const rules = [
  observationRules,
  storageGuidance,
  '保存能让未来的 agent 做得更好的事实。',
  '一事实一文件。已有事实变化时按原 ID 修订，错误条目用 forget 遗忘。',
  '禁止保存代码结构、Git 历史、已修复的单个 bug、单轮对话细节，以及当前 SHA、分支尖端、在途任务等实时状态。',
  '现行用户指示及项目指令优先。',
  '需要核对正文时按需使用 show <id>。使用记忆时在根轮引用 [memory:<id>]。',
];
const roleRules = {
  super: '维护用户偏好及跨项目裁决与经验。',
  auditor: '维护本项目裁决与偏好，并审查相应候选。',
  leader: '维护本项目经验，并审查经验候选。',
  worker: '用 propose 提交待审候选。',
};
const reminderEvents = new Set(['card_close', 'handover', 'pre_compact']);

export function renderMemoryPrompt({ binding, template = '', entries = [] }) {
  const lines = entries.map(({ line, id, title }) => line ?? `- ${id} — ${title}`);
  return [template, [...rules, roleRules[binding?.role]].filter(Boolean).join('\n'),
    [background, ...lines].join('\n')].filter(Boolean).join('\n\n');
}

export async function handleMemoryEvent({ binding, type, explicitWrite }, { remind, write }) {
  if (reminderEvents.has(type)) {
    await remind?.(['worker', 'reviewer'].includes(binding?.role) ? roleRules[binding.role] :
      [memoryWriteReminder, observationRules].join('\n'));
  }
  if (explicitWrite !== undefined) return write(binding, explicitWrite);
}
