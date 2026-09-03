# 消息选择与 canonical 转发实现审计

日期：2026-09-04

## 结论

P2.1 消息选择模式与 P2.2 **无附件普通消息**的 canonical 多目标转发已经形成前后端闭环。实现复用
Raft 可证明的前端/请求/显示合同，后端映射到 RAH OS 的本地 Room-first Kernel；Multica 当前没有可
复用的同类业务 owner。本批没有把 DOM 文本拼成普通消息，也没有让浏览器持有 authoritative snapshot。

本报告正文记录的是 P2.2 当时验收快照。P2.3 后续已按
[专项合同](../product/2026-09-04-forwarded-attachment-projection-contract.zh-CN.md)开放附件；嵌套转发、系统/action 来源、跨 Workspace/跨 Computer 转发和
转发正文全文搜索仍未开放，因而不能据此宣称 Chat 全功能与 Raft 完全一致。

## 上游证据与复用裁决

- Raft 冻结入口：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
  `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
- UTF-16 约 `2855000..2856200`：选择 scope、Thread 根、selected IDs；约
  `2983000..2985200`：选择工具栏；约 `3016000`：resolved/unresolved 与 canonical 排序；约
  `3187200..3188500`：composer 替换、Escape 与导航清理；约 `3204100..3231500`：10 个目标、20 条
  搜索、请求参数、部分成功与稳定 request ID 重试。
- Multica revision `11861145abc59a0d39c8c8f24ad837d4584e664f` 没有聊天 forwarded bundle 或
  目标搜索实现。其标签/技能/成员多选不拥有消息语义，因此未采用。

## 单一 owner 与数据流

```text
Web in-memory selection
  -> typed message.forward.targets / message.forward
  -> Human Application Service authentication
  -> Kernel MessageForwardingService
       -> canonical source read + source/target ACL
       -> durable request-level frozen snapshot
       -> one independent transaction per destination
  -> canonical message.posted + messages.forwarded_bundle_json
  -> Room projection / renderer / notification / typed source link
```

schema 46 增加 `messages.forwarded_bundle_json` 与 `message_forward_requests`。后者按
`actor + requestId` 冻结源集合、首批目标集合、附言和完整 bundle；后续只允许首批目标的子集重试。
因此即使作者在部分失败后改名或换头像，各目标仍获得相同历史快照。每个目标独立事务，失败不会回滚
已成功目标；目标 Room 的 event idempotency 阻止重复写入。

## 安全与业务语义

- 源由 Kernel 按 Room event sequence 重新读取；浏览器不能提交作者、正文、时间或 Thread 身份。
- 目标只包括同 Workspace、当前 Human 已加入、未归档的 Channel/DM；最多 10 个。
- “查看原消息”携带 message/thread/root typed target，点击时由现有导航 owner 重查存在性与 ACL。
- Forward 不是 mention；事件的 recipients 为空，不生成 Agent Inbox/Activation。
- 任何附件、已转发 bundle、Task/action 或系统来源整体拒绝，并返回结构化 409 错误；不静默丢字段。
- 无附言消息的 Web Push 文本为“转发了 N 条消息”。转发快照中的上传头像进入 GC 引用图，作者以后
  更换头像也不会破坏历史显示。
- 源 Room 永久删除会显式擦除该 Room 的 `message_forward_requests` 幂等快照；已经投递到其他 Room 的
  canonical 转发消息保持不变。该软引用不依赖外键遍历，已有独立删除回归防止遗漏。

## 自动化证据

- Protocol：bundle 不可变形状、唯一源/目标、100 条源/10 个目标上界、逐目标结果。
- Kernel：Room 顺序、Thread root/reply 身份、无 Agent attention、部分成功、目标 ACL、嵌套拒绝、
  exact replay、请求冲突、资料变化后的快照稳定、非初始目标拒绝。
- Migration：模拟 schema 45，保留既有消息并补建两处 durable storage 后可转发。
- Profile image：只由 forwarded snapshot 引用的上传头像不会被 GC 回收。
- Application Service：目标搜索/转发 round-trip；嵌套来源返回
  `409 forwarded_source_not_supported`，不是 500。
- SDK/UI：typed operation 完整；选择 scope、Thread 联动、未解析 fail closed、modal Escape ownership。
- 2026-09-04 最终门禁：package tests `859 total / 857 pass / 2 opt-in paid Provider skipped`；Web unit
  `252/252`；callback regression `34/34`。`npm run typecheck`、`git diff --check`、全仓
  `prettier --check .` 与 `npm audit --omit=dev`（0 vulnerabilities）通过。
- Room/Thread 选择、复制、转发前置检查及 Escape ownership 已收敛到一个 Web hook；历史大组件减少
  127 行，没有再维护两套行为。

## 真实 Chrome 结果

隔离 fixture 使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`：

1. Desktop：从 Design Lab 选择一条 Human 消息和一条 Kimi 回复；打开转发窗口，选择 Agent Council，
   添加附言并提交。
2. 目标 Room 恰好出现一条 canonical message，刷新数据仍含附言和两条快照；两条“查看原消息”存在。
3. 点击来源链接回到 Design Lab，并聚焦精确源消息。
4. `390×844`：选择工具栏和转发 dialog 保持在视口；第一次 Escape 只关闭 dialog，选择仍在；第二次
   Escape 才退出选择。

门禁最终输出：

```text
RAH_REAL_BROWSER_GATE {"browser":"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","viewport":"390x844"}
RAH_LOCAL_WORKBENCH_GATE {"agentReply":true,"persistentRestart":true,"providerSessionResume":true,"productionBuild":true,"seamlessBrowserRestart":true,"viewport":"390x844"}
RAH_FIREFOX_WORKBENCH_GATE {"browser":"Firefox 150.0.2","desktopViewport":"1440x1000","mobileViewport":"390x844","persistent":true}
```

另以 Chrome 在 `1440×1000` 与 `390×844` 验证 10,050 条逻辑消息的虚拟窗口：DOM 仅 27 行，向上
分页后锚点位移为 0；Markdown 异步刷新 20 次无失败。Firefox 复核了同一正式构建的桌面/移动工作台、
消息菜单（含“选择消息”）与持久重启路径。

## 正式 4173 发布复核

- 最终源码重新执行 `npm run build:web:workbench`；正式服务只消费该次构建的 immutable asset
  snapshot。当前入口资产为 `/assets/index-N2xLPT0m.js`，build id 为
  `e4178147f3fecc4f3c49afa9f3beef26e5eadbd31213da3540026552c464dd23`。
- 重启前审计确认 30 个 Activation 均为 `completed`、30 个 RunAttempt 均为 `exited`、30 个
  RuntimeProcess 均为 `terminated`；exclusive lease 与 Placement 均已释放，也没有未解决
  cancellation、SOS hold、Computer operation 或 Workspace lease。正式状态备份位于
  `/Users/sun/.rah/backups/pre-p22-message-forward-20260904-yEPPx3/`；Room 与 Runtime Registry 数据库均
  通过 `PRAGMA quick_check`，Room schema 为 46。备份 Room DB 已切换为 DELETE journal 后再次以只读
  模式核验。
- `doctor:local-core` 同时发现既有正式 SQLite 文件权限为 `0644`，重启前将 `room.db`、
  `runtime-registry.db`、`web-push.db` 及 Room WAL/SHM 收紧为 owner-only；修复后 doctor 四项检查全部
  通过。停止旧进程后执行 `wal_checkpoint(TRUNCATE)`，再确认 `quick_check=ok` 和 schema 46。
- 正式实例由新进程 PID 43533 监听 `127.0.0.1:4173`，`/_rah/health` 返回 `online`。重启后持久化状态仍为
  6 个 Room、40 条消息、4 个 Agent、1 个 Task，且没有 active Activation、Run 或 RuntimeProcess；本批
  正式只读 UI 验收没有创建转发请求或唤醒 Agent。
- 正式数据上的 in-app browser 文档成功渲染 Agent Council、Room sidebar、11 个当前窗口消息行和
  composer。最后一条消息的右键菜单精确包含 7 个快捷 reaction，以及“复制链接 / 复制 Markdown /
  选择消息 / 在消息列中回复 / 收藏消息 / 转为任务”。点击“选择消息”后，工具栏显示“已选择 1 条 / 全选 /
  转发 / 复制链接 / 复制 Markdown / 取消”，composer 被替换；按 Escape 后选择归零且 composer 恢复。
  `Cmd+R` 强制刷新后仍显示 11 行消息与 composer，选择态未泄漏，也没有可见的 `NetworkError` 或
  `JSON.parse` 错误。
- CUA 的 Chrome surface 在本轮正式复核时不可用，因此正式持久化数据的最后一步使用 in-app browser；
  相同构建的 Chrome、Firefox 及 390×844 行为已由前述独立真实浏览器门禁覆盖。这一区分保留在审计中，
  不把 in-app browser 结果伪称为正式 Chrome 结果。

## 剩余差距与优先级

1. **P2.3 附件转发**：已由后续专项合同实现；本报告的浏览器证据仍只覆盖当时的纯文本场景，最终结果
   以 P2.3 新审计为准。
2. **P2.4 全文搜索策略**：当前 Search 索引附言，不索引 bundle 内历史正文。是否纳入必须先决定结果
   展示和源 ACL 撤销语义。
3. **P3 消息编辑/删除、完整 emoji picker、回应者浮层**：属于 Chat 其余可见差距，不由本批覆盖。
4. **跨 Workspace/跨 Computer**：当前产品决策排除；不是本地核心收口阻塞项。
