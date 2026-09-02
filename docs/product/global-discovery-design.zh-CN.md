# 全局 Tasks / Search / Activity：Raft 对齐设计与施工门槛

状态：2026-09-01。首轮设计及第二次审查先于施工；旧实现证据见[第二批报告](../audits/2026-08-30-global-discovery-closure.zh-CN.md)，后续 Raft Search UI、FTS5 与 typed navigation 收口见[最新产品合同](./2026-09-01-notifications-typed-navigation-contract.zh-CN.md)及[验收报告](../audits/2026-09-01-notifications-typed-navigation-verification.zh-CN.md)。

## 上游证据与移植边界

- Raft 官方 Web 发布包：`../raft-ui/vendor/raft/index-WTraJnrd.js`。全局 Tasks `channel/private` 过滤、频道/创建者/负责人多选、五组状态及默认折叠 Done/Closed、点击打开原消息列。`hnt` 的状态排序与任务号倒序可移植，身份字段映射到 RAH principal。
- 同包 `Sa`：Activity identity 是 thread 或 conversation，不是每条消息；`markDone` 发送所见 `throughActivitySeq`，**不调用 task status API**。这个状态机移植到 Kernel Human read-state owner，不复刻 Zustand 网络补丁。
- 官方登录页面本轮实测：全局 Tasks 显示“个频道任务”；Activity 包含频道卡、私聊卡、消息列卡，全部/未读/提及及全部已读；Search 有发送者/范围/频道/时间/排序，并能搜索人、Agent、消息。
- 官方文档本地镜像 `raft-runtime-forensics/artifacts/upstream/raft-docs/content/{search-your-raft,features/messaging/activity,features/collaboration/tasks}/index.md`。
- `raft-computer-1.0.18/source-slices/.../activity.ts` 是被 tree-shaking 后的空初始化，**没有服务端查询实现**。不得称为已复制 Raft server。SQL/ACL/分页是 RAH 的必要适配；不引入旧 rah session 模型。
- 视觉继续用可追溯的 Raft CSS、图标、字体和 computed tokens；不使用 reference fixture 的假查询/数组反转作为业务代码。

## 单一 owner 和查询范围

`Kernel GlobalDiscovery` 负责当前 Human 可访问 Workspace 中的查询与独立已读/处理水位。经 HumanApplicationPort → HTTP → SDK → 同一 Web/PWA 组件。每次查询及翻页重新检查 Room membership；control/归档 Room 不进入这些产品视图。

1. 全局 Tasks：仅 channel，频道/创建者/负责人多选在 SQL 过滤，私聊任务保留在私聊任务页。分页有固定创建水位，不偷渡整个历史到浏览器。列表/看板同一数据源；跨 Room 点击必须携带 Room + root message，原任务权限/变更仍由 Room use case 管。
2. Search：频道/本人私聊/消息列及可见目录名；发送者、Room、日期、范围与排序在 Kernel。正文当文字处理，不允许 HTML 注入。命中定位用 exact message + bounded context，不扫描所有历史，不伪造全文相关度算法等同 Raft。附件正文搜索不在本批。
3. Activity：频道/私聊顶层消息聚合为一张 conversation 卡；关注线程单独一张卡。默认关注本人创建/参与的线程，显式 follow/unfollow 覆盖自动关注。提及只在已授权 Room 内；RAH 不借 @mention 扩大私有 Room 权限。read/done 分开，按所见消息水位单调推进，不能吞掉请求发出后新增的消息。done 不改变 Task/Inbox/Activation；新消息越过 done 水位重新出现。
4. 全局 URL 保存 surface/筛选及当前 Room（由它解析 Workspace）；命中携带 Room/message/thread 身份。客户端丢弃已取消或过期查询，不用旧 Workspace 的响应覆盖新页面。
5. 精确上下文只是只读定位窗口，不是第二份实时对话。提交成功后仅退出同一 messageId 的定位窗口，恢复 Room/Thread canonical 消息；迟到的提交不能清除用户新选的目标。虚拟列表负责按消息身份滚动，动态行测量不得把尾部消息推到视口外；用户向上阅读则释放贴底。

施工复审补充：schema v20 的辅助 view 使用索引查回 canonical message sequence；线程跟随/提及资格按 thread 计算一次，避免每条回复重复扫描整列。read/done 仍是 Human 私有持久水位。普通对话由可见 DOM 消息的 canonical sequence 确认已读；virtual overscan 和 event replay 不算阅读。SQL 是本机适配，不声称上游 server 移植。

## 2026-09-01 Search 收口补充

- Web 已移植 Raft 发布包可见的 200ms debounce + AbortController、过期响应丢弃、目录/消息分区、Thread“消息列”聚合、append pagination、workspace-scoped 有界历史/常用查询；
- schema 27 增加 SQLite FTS5 external-content 索引及 insert/delete/update trigger。3 个以上 Unicode code point 先用 trigram 缩小候选，再作字面量校验；短查询保留有界 CJK fallback；
- exact/prefix/substring rank 与稳定 identity tie-breaker 是本机可审计适配。Raft server rank 没有出现在授权发布源码中，因此不宣称服务端算法同构；
- 每个结果使用 `NavigationTarget`，点击仍由 `HumanNavigation.resolve` 重新验证 existence/ACL；Search history 不是 transcript cache，也不能恢复失权结果。

## 二次审查结论（先于施工）

- 必须采用已见水位而非 click 时服务端最新值，否则并发回复丢失。read-state 属于 Human 私有投影，不是 Room business mutation，不唤醒 Agent；与既有 cursor acknowledgement 同类。该例外不允许业务任务绕过 ledger。
- 每页重做 ACL，游标绑定 Human、Workspace 和查询条件。服务端 limit 有上限；客户端只保留有界窗口。排序采用稳定 tie-breaker；相关性算法明确是本地适配，不宣称复制不可见服务端。
- 不把对话游标已投递当 Human 已读；只有实际打开/显式已读后推进 Human 水位。
- 不为了 UI 一致而放开危险状态拖动；从全局卡进入原 Task 操作路径，仍有基于 Room seq 的权限与安全改派。
- 无需改 Agent CLI、memory、付费 runtime、远程 Computer。测试使用隔离数据库和 fake runtime；不重启 4173 正式实例。

## 验收

先红后绿：跨 Room/Workspace、DM 排除、control 排除、陌生人及退群后 ACL、字面量搜索、分页新增、旧消息定位、跟随线程与提及、read/done 分离、并发新回复恢复、进程重开持久化。然后 HTTP/SDK conformance，真实浏览器 1440×1000 与 390×844；记录实际覆盖与未覆盖，不以源码已写或测试数量宣称像素/功能 100%。
