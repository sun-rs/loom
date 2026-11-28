import { basename } from 'node:path';
import { duration } from './status-accounts.mjs';
import { row, safe, truncate } from './status-layout.mjs';

const reasons = { completed: '目标已完成', 'no-open-work': '无在途工作', paused: 'Super 已暂停',
  'quota-reset': '等待额度重置', 'waiting-user': '等待用户，已通知 Super' };
const states = {
  working: ['◉ 工作中', 'good'], idle: ['○ 空闲', 'muted'], 'waiting-user': ['◷ 等用户', 'warn'],
  'waiting-super': ['◷ 等 Super', 'warn'], 'quota-wait': ['◷ 等额度', 'warn'], 'auth-expired': ['× 登录失效', 'bad'],
  stuck: ['! 卡住', 'bad'], blocked: ['◆ BLOCKED', 'warn'], exited: ['— 已退出', 'muted'],
};
const alertLabels = {
  'project-idle-warning': '项目停滞', 'project-idle-urgent': '项目紧急停滞', 'decision-overdue': '待决超时',
  'quota-wait': '额度等待', 'auth-expired': '登录失效', 'delivery-stalled': '投递卡住', 'ccp-guard': 'CCP 守卫',
  stuck: '会话卡住', blocked: '卡片阻塞',
};
const stamp = at => Number.isFinite(at) ? new Date(at).toISOString().slice(5, 16).replace('T', ' ') + 'Z' : '—';
const roleName = role => ({ super: 'Super', leader: 'Leader', auditor: 'Auditor', worker: 'Worker' })[role] ?? role;
const elapsed = value => Number.isFinite(value) ? duration(value) : '—';

export function scopeSummary(scope, compact = false) {
  const waiting = scope.pendingCount + (scope.pendingCount ? '（最长 ' + elapsed(scope.longestDecisionWaitMs) + '）' : '');
  return [
    (compact ? '进展 ' : '上次进展 ') + stamp(scope.lastProgressAt), '停滞 ' + elapsed(scope.stalledMs),
    (compact ? '待决 ' : '待 Super 决定 ') + waiting,
    '告警 ' + scope.alertCount, reasons[scope.reason], scope.pause?.reason,
    scope.retryAt != null && '重置 ' + stamp(scope.retryAt),
  ].filter(Boolean).map(safe).join(' · ');
}

export function decisionSummary(item) {
  return ['待 Super 决定', '已等 ' + elapsed(item.waitingMs), item.text].map(safe).join(' · ');
}

export function healthRoleRows(roles, width, paint, selected) {
  return roles.map(item => {
    const [label, tone] = states[item.state] ?? states.idle;
    const access = [item.cli, item.model].filter(Boolean).map(safe).join('/');
    const subject = [roleName(item.role), item.task].filter(Boolean).map(safe).join(' ');
    const id = 'health-role:' + item.addr;
    const summary = [subject, label, item.retryAt != null && '重置 ' + stamp(item.retryAt), access,
      '活动 ' + stamp(item.lastActivityAt)].filter(Boolean).join(' · ');
    return row(paint(selected === id ? 'selected' : tone, truncate('  ' + summary, width)), {
      id, title: subject, addr: item.addr, singleClick: true,
      fields: [['状态', label], ['CLI / 模型', access], ['卡片', item.task], ['会话地址', item.addr],
        ['上次活动', stamp(item.lastActivityAt)], ['额度重置', item.retryAt != null ? stamp(item.retryAt) : undefined],
        ['上下文', item.contextPercent != null ? Math.round(item.contextPercent) + '%' : undefined],
        ['压缩次数', item.compactions], ['换班', item.rotationDue ? '到卡片边界换班' : undefined],
        ['工作目录', item.cwd], ['原生会话', item.sessionId], ['详情', item.detail]],
    });
  });
}

export function healthAlertRows(alerts, width, paint, selected, all = false) {
  return alerts.map(item => {
    const id = 'health-alert:' + item.kind + ':' + item.id;
    const label = alertLabels[item.kind] ?? item.kind;
    const subject = [all && basename(item.project ?? ''), item.role && roleName(item.role), item.text].filter(Boolean).map(safe).join(' · ');
    const tone = item.severity <= 1 ? 'bad' : 'warn';
    return row(paint(selected === id ? 'selected' : tone, truncate('  ! ' + label + (subject ? ' · ' + subject : ''), width)), {
      id, title: label, singleClick: true,
      fields: [['项目', item.project], ['会话地址', item.addr], ['开始', stamp(item.at)],
        ['额度重置', item.retryAt != null ? stamp(item.retryAt) : undefined], ['详情', item.text], ['建议动作', item.action]],
    });
  });
}

export function healthDecisionRows(pending, width, paint, selected) {
  return pending.map(item => {
    const id = 'health-decision:' + item.id;
    return row(paint(selected === id ? 'selected' : 'warn', truncate('  ◷ ' + decisionSummary(item), width)), {
      id, title: '待 Super 决定', singleClick: true,
      fields: [['事项 ID', item.id], ['提交者', item.addr], ['等待', elapsed(item.waitingMs)], ['事项', item.text]],
    });
  });
}
