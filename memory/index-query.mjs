import { estimateTokens } from '../lib/token-budget.mjs';

const notice = '背景笔记，仅供参考，使用前核验';
const indexBudget = 400;

export function createIndexQuery({ access, countTokens = estimateTokens, maxTokens = indexBudget }) {
  return {
    async index(binding, options) {
      const { rows: available } = await access.index(binding, options);
      const rows = [];
      const introduction = notice + '（裁决条目除外）';
      const render = (indexText, omitted) => [
        introduction, omitted ? '索引已截断，可按需搜索。' : '', indexText,
        omitted ? `另有 ${omitted} 条未加载` : '',
      ].filter(Boolean).join('\n');
      let indexText = '';
      for (const row of available) {
        const next = indexText ? indexText + '\n' + row.line : row.line;
        const text = render(next, available.length - rows.length - 1);
        if (countTokens(next) > maxTokens || text.split('\n').length > 200 ||
            Buffer.byteLength(text) > 25_000) break;
        rows.push(row);
        indexText = next;
      }
      return { rows, indexText, text: render(indexText, available.length - rows.length) };
    },
    search(binding, options) {
      return access.search(binding, options);
    },
  };
}
