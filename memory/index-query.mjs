import { estimateTokens } from '../lib/token-budget.mjs';

const notice = '背景笔记，仅供参考，使用前核验';
const indexBudget = 400;

export function createIndexQuery({ access, countTokens = estimateTokens }) {
  return {
    async index(binding, options) {
      const { rows: available } = await access.index(binding, options);
      const rows = [];
      let indexText = '';
      for (const row of available) {
        const next = indexText ? indexText + '\n' + row.line : row.line;
        if (countTokens(next) > indexBudget) break;
        rows.push(row);
        indexText = next;
      }
      const truncated = rows.length < available.length;
      const text = [notice, indexText, truncated ? '索引已截断，可按需搜索。' : '']
        .filter(Boolean).join('\n');
      return { rows, indexText, text };
    },
    search(binding, options) {
      return access.search(binding, options);
    },
  };
}
