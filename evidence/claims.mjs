const claimRules = [
  ['done', /^(?:[#>*\-\s]*)(?:(?:status\s*:\s*)?DONE)(?=[\s:*]|$)/gi],
  ['all-green', /全绿|(?:全部|均)通过|\ball (?:tests|checks) (?:are |have )?(?:green|pass(?:ed)?)\b/gi],
  ['pass-count', /(?:通过(?:了)?\s*(\d+)\s*(?:项|个|条|项测试)|\b(\d+)\s*(?:项|个|条)(?:测试|检查)?(?:全部|均)?通过|\b(\d+)\s+(?:(?:tests?|checks?) (?:have )?)?passed\b)/gi],
  ['merged', /(?:已(?:经)?\s*(?:合入|合并)|\b(?:already |has been |were |was )?merged\b)/gi],
];

function claimsIn(text) {
  const found = new Map();
  let fence = null;
  for (const line of (text ?? '').split(/\r?\n/)) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker && fence === marker) fence = null;
    else if (marker && fence === null) fence = marker;
    if (marker || fence || /^\s*>/.test(line)) continue;
    for (const [kind, pattern] of claimRules) {
      for (const match of line.matchAll(pattern)) {
        const prefix = line.slice(0, match.index);
        if (/(?:未(?:能|曾)?|尚未|没(?:有)?|并非|不(?:是|能)?|\b(?:not|never|if|expected))\s*$/i.test(prefix)) continue;
        const count = kind === 'pass-count' ? Number(match.slice(1).find(value => value !== undefined)) : null;
        if (count !== null && !Number.isSafeInteger(count)) continue;
        const key = `${kind}:${count ?? ''}`;
        if (!found.has(key)) found.set(key, { kind, text: match[0].trim(), ...(count !== null && { count }) });
      }
    }
  }
  return [...found.values()];
}

export function latestChecks(commands) {
  return [...new Map(commands.map(command => [`${command.cwd ?? ''}\0${command.command}`, command])).values()];
}

const finding = (status, reason) => ({ status, reason });

function compare(claim, git, verification, checks, failed) {
  if (claim.kind === 'done') {
    if (failed || verification.turnStatus === 'interrupted') return finding('MISMATCH', '轮末失败或中断');
    if (verification.turnStatus === 'completed' && checks.some(check => check.result !== 'unknown')) {
      return finding('MATCH', '原生轮已完成，有验证记录');
    }
    if (verification.turnStatus === 'completed') return finding('UNVERIFIED', '原生轮已完成，缺少可确认验证');
    return finding('UNVERIFIED', '缺少完成记录');
  }
  if (claim.kind === 'merged') {
    if (git.merge?.integrated === true) return finding('MATCH', '目标引用包含工作提交');
    if (git.merge?.integrated === false) return finding('MISMATCH', '未在目标引用确认工作改动');
    return finding('UNVERIFIED', '缺少有效合入目标');
  }
  if (claim.kind === 'pass-count') {
    const counts = checks.map(check => check.counts.passed).filter(count => count !== null);
    if (counts.includes(claim.count)) return finding('MATCH', `输出报告 ${claim.count} 通过`);
    if (counts.length) return finding('MISMATCH', '已记录的单次通过数不符');
    return finding('UNVERIFIED', '缺少测试计数');
  }
  if (checks.some(check => check.result === 'failed')) return finding('MISMATCH', '有验证失败');
  if (checks.some(check => check.counts.skipped > 0 || check.selective) ||
    git.tests?.some(test => test.changes?.addedSkip || test.changes?.addedOnly)) return finding('MISMATCH', '存在跳测或仅跑部分测试');
  if (verification.status !== 'ok') return finding('UNVERIFIED', '缺少该轮执行记录');
  if (!checks.length) return finding('MISMATCH', '本轮未记录验证执行');
  if (checks.every(check => check.result === 'passed' && check.counts.passed !== 0)) return finding('MATCH', '已记录的验证通过');
  return finding('UNVERIFIED', '无法归属测试退出状态');
}

export function compareClaims(text, git, verification, failed = false) {
  const checks = latestChecks(verification.commands);
  return claimsIn(text).map(claim => ({ ...claim, ...compare(claim, git, verification, checks, failed) }));
}
