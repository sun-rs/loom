import { accountVersion } from '../adapters/accounts/versions.mjs';

const fixedResumeVersions = {
  codex: new Set(['0.171.0', '0.172.0']),
  agy: new Set(['1.5.17', '1.5.18']),
  opencode: new Set(['2.3.0']),
};

const shellQuote = value => JSON.stringify(String(value));

export function freshHandoffCommand(project, row, job) {
  if (!row || row.role === 'super') return 'loom up --fresh';
  const cwd = row.cwd ?? project;
  const parts = ['loom', 'spawn', row.role, '--project', shellQuote(project), '--cwd', shellQuote(cwd)];
  if (row.role === 'worker') {
    if (row.task) parts.push('--task', row.task);
    if (row.wave) parts.push('--wave', row.wave);
    const handoff = job?.workerHandoff?.path;
    const prompt = handoff
      ? `Read worker handoff ${handoff} and continue task ${row.task ?? ''}.`
      : `Continue task ${row.task ?? ''} in ${cwd} from the existing worktree state.`;
    parts.push(shellQuote(prompt));
    return parts.join(' ');
  }
  const prompt = `Read the latest handover brief for ${row.role} (${row.addr}) and take over.`;
  parts.push(shellQuote(prompt));
  return parts.join(' ');
}

function normalizedVersion(version) {
  const parsed = accountVersion(version);
  return parsed ? parsed.replace(/^v/i, '') : null;
}

export function nativeResumeCapability({ cli, backend = 'tui', sessionId, cliVersion, ccpBridge, project, row, job } = {}) {
  const effectiveSessionId = sessionId ?? row?.sessionId ?? null;
  const effectiveCli = cli ?? row?.cli;
  const effectiveBackend = backend ?? row?.backend ?? 'tui';
  const effectiveVersion = cliVersion ?? job?.cliVersion ?? null;
  const freshCommand = freshHandoffCommand(project, row, job);
  const resumeCommand = row?.role === 'super'
    ? 'loom up --resume'
    : row?.addr && project
      ? `loom resume ${row.addr} --project ${shellQuote(project)}`
      : undefined;

  if (!effectiveSessionId) {
    return {
      supported: false,
      status: 'missing-session-id',
      reason: '无法原生续接：未记录原生会话 ID',
      freshCommand,
    };
  }

  if (effectiveCli === 'claude') {
    if (ccpBridge?.ready) {
      return {
        supported: true,
        status: 'supported',
        viaCcp: true,
        reason: '经 CCP-ROUTE-1 接口续接',
        ...(resumeCommand && { resumeCommand }),
        freshCommand,
      };
    }
    return {
      supported: false,
      status: 'not-ready',
      viaCcp: true,
      reason: 'Claude 续接依赖 CCP-ROUTE-1 经 CCP 接口（尚未交付）',
      freshCommand,
    };
  }

  if (!Object.hasOwn(fixedResumeVersions, effectiveCli)) {
    return {
      supported: false,
      status: 'unsupported',
      reason: `无法原生续接：不支持的 CLI (${effectiveCli ?? 'unknown'})`,
      freshCommand,
    };
  }

  if (effectiveVersion != null) {
    const version = normalizedVersion(effectiveVersion);
    if (!version || !fixedResumeVersions[effectiveCli].has(version)) {
      return {
        supported: false,
        status: 'unsupported',
        reason: `无法原生续接：${effectiveCli} ${effectiveVersion} 不在已验证的固定版本续接支持列表内`,
        freshCommand,
      };
    }
  }

  if (effectiveCli === 'opencode' && effectiveBackend === 'tui') {
    return {
      supported: false,
      status: 'unsupported',
      reason: '无法原生续接：OpenCode 2.3.0 TUI 模式的 --session 缺少会话归属确认，请用交接单新开',
      freshCommand,
    };
  }

  return {
    supported: true,
    status: 'supported',
    reason: effectiveCli === 'codex'
      ? (effectiveBackend === 'headless' ? 'Codex thread/resume' : 'Codex TUI resume')
      : effectiveCli === 'agy'
        ? (effectiveBackend === 'headless' ? 'agy ACP session/load' : 'agy --conversation')
        : 'OpenCode ACP session/load',
    ...(resumeCommand && { resumeCommand }),
    freshCommand,
  };
}
