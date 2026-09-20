# 全局任务看板／列表记忆

## 来源与范围

Raft v1.16.0 发布源码来源、哈希与许可边界沿用
[任务交互审计](./2026-09-20-task-assignee-status-and-live-badge.zh-CN.md)。
分析文件 `raft-task-readable.js` 178950–178972 的 `Lfe/Ofe/Bbt/$bt`
使用 `slock.tasks.viewMode`、board/list 校验和带异常保护的 localStorage；
179279 起以 768px 判断初始默认。这里为结构移植及 RAH glue，未复制发布 bundle。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/core/issues/stores/view-store.ts` 用 workspace-aware Zustand persist 保存多种视图；
本次采用 Raft 更直接的双模式本地偏好，不引入 Multica store 依赖。

用户本轮要求优先：仅全局任务页持久保存主动选择；安装式 PWA 无记录默认列表。
普通浏览器沿现有任务内容区 ResizeObserver，以 768px 为默认分界。
自动适配不写偏好，主动选择后不随缩放覆盖；URL 中有效的显式 view 保留深链优先级。

## 所有者

`apps/web/src/use-task-view-preference.ts` 为 Human × Workspace 的本地展示偏好 owner，
使用版本化 localStorage key；无消息、任务业务状态或后端投影副本。
无效值视为无记录，存储不可用时仍允许当前挂载期间切换。
Room 内任务页仍沿原共享响应式默认，不引入全局任务页的偏好。
筛选器继续使用原有会话生命周期，不因视图持久化而改变。

## 验证

`scripts/test-task-view-memory-browser.mjs` 首先复现选择列表后离开再进入恢复看板的失败，
修复后检查真实鼠标切换、主导航往返、刷新、1440/390×844 下默认和显式选择、
安装式 PWA 环境信号下默认列表及主动选择恢复。
PWA 检测测试为浏览器注入 standalone 信号，非真机安装验收。

Chromium、WebKit 隔离浏览器均通过；既有筛选会话两项测试、Web 类型检查、正式构建与
`git diff --check` 通过。全仓库 check 停在既有 `/v1/worker/message-present` 登记项，
format:check 仍报告既有五个无关文件。

正式实例已完成活动检查、持久状态备份及安全重启，冻结构建
`483e10461ca8b9e3e6e6832dd0507bda7c2af7707a57cd944ad6a2c616af5d2c`。
新 Chromium 正式页面验证列表选择、聊天／任务主导航往返和刷新保持，截图已人工检查。
