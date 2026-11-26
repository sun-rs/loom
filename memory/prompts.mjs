const reminder = '默认不写。未来的 agent 看到这条，会因此做得更好吗？';
const background = '背景笔记，仅供参考，使用前核验';
export const observationRules = [
  'Keep durable observations for future sessions: user (preferences), feedback (confirmed corrections or practices), project (lasting decisions or constraints), reference (where to verify information).',
  'Skip code structure, Git history, facts already documented in the repository, and one-off progress or details of the current conversation.',
  'Use separate Why: and How to apply: lines in the body to explain the reason and specify when and what to do.',
].join(' ');

export function memoryStartupPrompt(role, indexText) {
  const guidance = ['leader', 'auditor'].includes(role) ? [
    'Memory writing',
    observationRules,
    'Search for duplicates with loom mem search and verify with loom mem show. Update the existing entry when the fact changes.',
    'Use loom mem write for a new fact, loom mem update to correct outdated guidance, and loom mem invalidate when it no longer applies. Follow your role’s write permissions.',
  ].join('\n') : '';
  return [guidance, indexText].filter(Boolean).join('\n\n');
}
const rules = [
  reminder,
  'ruling 记录已确认的裁决，preference 记录持久偏好，lesson 记录已验证的经验，candidate 等待审查。',
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
  reviewer: '按复核卡给出的范围阅读记忆。',
};
const reminderEvents = new Set(['card_close', 'handover', 'pre_compact']);

export function renderMemoryPrompt({ binding, template = '', entries = [] }) {
  const lines = entries.map(({ line, id, title }) => line ?? `- ${id} — ${title}`);
  return [template, [...rules, roleRules[binding?.role]].filter(Boolean).join('\n'),
    [background, ...lines].join('\n')].filter(Boolean).join('\n\n');
}

export async function handleMemoryEvent({ binding, type, explicitWrite }, { remind, write }) {
  if (reminderEvents.has(type)) await remind?.(reminder);
  if (explicitWrite !== undefined) return write(binding, explicitWrite);
}
