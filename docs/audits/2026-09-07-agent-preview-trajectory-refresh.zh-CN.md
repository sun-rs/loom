# Agent 预览轨迹更新

## 问题与唯一 owner

第四项先处理已登记的真实缺口：打开的头像预览原先依赖 activityAt，工具结束、text、system、
slock_action 或相同时间戳的新增轨迹不能触发重读。内核测试和 Chrome 实操门禁先复现失败。

Protocol 增加可选 trajectoryVersion，Kernel RuntimeTrajectory 从既有按 participant_id 索引的
server_sequence 尾记录读取；Presence 返回无正文提示；Web 仍走现有 reconciliation 与 AbortController，
仅打开且有权限的预览重读最近 5 条。没有新增数据库迁移、计时器、状态机或诊断历史存储。
activityAt 和 Raft status 映射不变；版本变化不能完成 Room、Inbox 或 Task。

## 来源与差异

沿用[页面族合同](../design/agent-computer-profile-family.md)登记的授权 Raft Web
XO/ent/ant/rnt 预览结构、权限与既有素材，没有更改视觉参数。
本地 frozen `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js` 的 mne 映射
SHA-256 为 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`，
现有测试逐状态对照继续通过。本次尾序号连接属于 RAH glue，不声称复制未知 Raft Server。

另查 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/mobile/data/realtime/use-presence-realtime.ts`：生命周期 query invalidation 特意跳过逐步
progress/message，不能直接修复本项目的最近轨迹预览。保留本机既有持久轨迹与刷新 owner，
未移植该代码，也未新增上游依赖。

## 验证与边界

日志：`/Users/sun/Code/reviews/rah_os/2026-09-07-trajectory-preview`。
`red.log` 是同时间戳非状态记录不刷新断言失败；`browser-red.log` 是保持打开的预览
等不到 updated_fixture_tool，均为修复前的预期失败。

`test:web:agent-preview` 复用既有 preview-content/lifetime 场景，Chrome/Firefox ×
1440×900/390×844 通过：只改变轨迹版本而时间戳不变、保留弹层身份、权限/空/读取错误、
指针进入离开、Escape 和延迟打开取消。仅使用明确标记的 UI fixture，无付费 CLI。
截图已查看桌面和手机尺寸，路径见 browser-green.log。

这关闭的是有界预览的失效更新缺口。完整上游动态过滤、每个 Provider 的能力变体、
文件菜单/预览交付、本机 Computer、必要 Settings 仍须逐环节核对。
本轮未进行新一轮官网同条件双边验收，不推导完整 Raft 复刻或真实 Provider 工作通过。

## 最终检查与正式恢复

首轮完整检查发现 Client API 的严格字段列表需要随新协议更新；保留该字段白名单，
增加 trajectoryVersion 的安全整数/非负断言，独立 HTTP 测试与最终完整检查通过。
`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench`、`npm run test:web:agent-preview` 均通过。
最终预览证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-preview-BCO0ij`。

正式实例经过 idle 检查、备份验证、精确 SIGTERM 和冻结资产启动：

- build：`2d3f2bac8f545bda3c6cf1569235106a4bdaf511ea08cc8632dad78d34caf131`。
- 备份：`/Users/sun/.rah/backups/pre-restart-c2549375-1690-411e-ac65-d9430050443f`。
- 交付时进程：65790；正式地址 <http://127.0.0.1:4173>。
- `test:web:formal-discovery` Chrome/Firefox 新页面通过，8 张截图，已查看正式桌面任务页面。
- 正式证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-ddkIgl`。

前后持久快照完全一致：6 Rooms、43 messages、2 Tasks、378 events、4 Agents、
35 configuration revisions、37 memory files；相关表及 runtime 配置摘要相同。
未运行付费 CLI，未提交或推送。此处关闭预览漏更新，不关闭第四项整组或第五项发布验收。
