import { readIdleAlarm } from './idle-alarm.mjs';
import { readNotifications } from './notifications.mjs';
import { readPolicy } from '../cli/policy.mjs';

const roleRank = { super: 0, leader: 1, auditor: 2, worker: 3 };
const waitingKinds = new Set(['awaiting-user', 'awaiting-approval', 'awaiting-choice', 'picker', 'overlay']);
const activeKinds = new Set(['busy', 'working', 'running', 'starting', 'sending', 'steering', 'interrupting']);
const stalledKinds = new Set(['stuck', 'silent-hang', 'waiting-poll', 'stalled']);
const accessGuard = /^(?:ccp(?:[-_ ].*)?|guard-ccp)$/i;

function roleState(row, pending) {
  if (row.endedAt != null || ['exited', 'ended', 'finished'].includes(row.state)) return 'exited';
  if (['quota-wait', 'auth-expired'].includes(row.health?.status)) return row.health.status;
  if (['quota-wait', 'auth-expired'].includes(row.state)) return row.state;
  if (row.awaitingUser || waitingKinds.has(row.state)) return 'waiting-user';
  if (pending && !activeKinds.has(row.state)) return 'waiting-super';
  if (stalledKinds.has(row.health?.status) || stalledKinds.has(row.state)) return 'stuck';
  if (activeKinds.has(row.state)) return 'working';
  if (row.lastResultTag === 'BLOCKED' || row.state === 'BLOCKED' || row.state === 'blocked') return 'blocked';
  return 'idle';
}

function alertForRole(role) {
  const actions = {
    'quota-wait': role.retryAt == null ? '核对用量上限并确认重置时间。' : '到重置时间后核对会话是否恢复。',
    'auth-expired': '检查原生 CLI 的登录状态，由授权操作者重新登录。',
    stuck: '核对最近的回合、工具与子进程，确认阻塞原因后恢复。',
    blocked: '查看卡片的 BLOCKED 报告和所需决定。',
  };
  if (!Object.hasOwn(actions, role.state)) return;
  return { id: 'role:' + role.addr, project: role.project, kind: role.state, addr: role.addr, role: role.role,
    at: role.since ?? role.lastActivityAt, text: role.detail, action: actions[role.state],
    ...(role.retryAt != null && { retryAt: role.retryAt }) };
}

const severity = {
  'project-idle-urgent': 0, 'ccp-guard': 1, 'auth-expired': 1, 'decision-overdue': 2, 'project-idle-warning': 2,
  'delivery-stalled': 2, stuck: 2, 'quota-wait': 3, blocked: 3,
};

export function projectHealth(scopes, { roles: observed = [], events = [], deliveries = [] } = {}) {
  const pending = new Set(scopes.flatMap(scope => scope.pendingDecisions.map(item => item.addr)));
  const roles = observed.filter(row => row.role !== 'worker' || row.inFlight || row.lastResultTag === 'BLOCKED').map(row => ({
    project: row.project, role: row.role, addr: row.addr, cli: row.cli ?? null, model: row.model ?? null, task: row.task ?? null,
    state: roleState(row, pending.has(row.addr)), lastActivityAt: row.lastActivityAt ?? row.startedAt ?? null,
    ...(row.health?.since != null && { since: row.health.since }),
    ...(row.health?.retryAt != null && { retryAt: row.health.retryAt }),
    ...((row.health?.reason ?? row.reason) && { detail: row.health?.reason ?? row.reason }),
  })).sort((a, b) => a.project.localeCompare(b.project) || Number(a.state === 'exited') - Number(b.state === 'exited') ||
    roleRank[a.role] - roleRank[b.role]);
  const byAddr = new Map(roles.map(role => [role.addr, role]));
  const alerts = [
    ...scopes.flatMap(scope => [
      ...(scope.severity ? [{
        id: 'project-idle:' + scope.project, project: scope.project, kind: 'project-idle-' + scope.severity,
        at: scope.stalledSince, text: '仍有未完成工作，项目角色无进展。', action: '核对待决事项、在途卡片与投递收件，再确定由谁恢复。',
      }] : []),
      ...scope.pendingDecisions.filter(item => item.remindAt <= scope.at ||
        events.some(event => event.type === 'decision-reminder' && event.decisionId === item.id)).map(item => ({
        id: item.id, project: scope.project, kind: 'decision-overdue', addr: item.addr, at: item.since, text: item.text,
        action: 'Super 查看事项原件并用 loom notifications --resolve-decision ' + item.id + ' --reason TEXT 登记处理。',
      })),
    ]),
    ...roles.flatMap(role => alertForRole(role) ?? []),
    ...deliveries.map(delivery => ({
      id: delivery.id, project: delivery.project ?? byAddr.get(delivery.target)?.project, kind: 'delivery-stalled',
      addr: delivery.target, at: delivery.stalledAt, text: delivery.reason,
      action: '核对目标会话与投递回执，再决定是否重试。',
    })),
    ...events.filter(event => accessGuard.test(event.reason ?? '') && event.resolvedAt == null && event.takenAt == null).map(event => ({
      id: event.id, project: event.project, addr: event.addr, kind: 'ccp-guard', at: event.at, text: event.text,
      action: '检查 CCP 守卫回执和受管入口状态，通过受管入口恢复。',
    })),
  ].map(alert => ({ ...alert, severity: severity[alert.kind] })).sort((a, b) =>
    a.severity - b.severity || (a.at ?? Infinity) - (b.at ?? Infinity) || a.id.localeCompare(b.id));
  const projects = scopes.map(scope => ({
    ...scope, pendingCount: scope.pendingDecisions.length, longestDecisionWaitMs: scope.pendingDecisions[0]?.waitingMs ?? 0,
    alertCount: alerts.filter(alert => alert.project === scope.project).length,
  }));
  return { projects, roles, alerts };
}
export function readOfflineHealth(project, at, events = readNotifications(project), options) {
  if (options === undefined) {
    try { options = readPolicy(project, { optional: true }).idleAlarm; } catch {}
  }
  return projectHealth(readIdleAlarm(project, events, at, options), { events });
}
