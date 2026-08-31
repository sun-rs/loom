# Agent Memory：App Inbox 接入与复核报告

日期：2026-08-30。范围：Raft 基线、当前 Run 的 Computer-local App Inbox、来源重查与生命周期；不是整个产品的重新认证，也不是新的第三方模型审计。

## 结论

当前 Run 的 **查看 → Agent 自行整理 → 显式重查/确认通知** 链路已接入并通过真实 Node 子进程验收。没有加入记忆切分、内容选择、observer、向量库或新记忆 owner。

这不等于 Agent 已自动整理出正确笔记，也不等于整个 Raft Memory 生命周期 100% 收口。空闲自治维护、active notice、当前版本真实模型/浏览器召回和旧冻结 prompt 升级仍未验收。在线服务未重启，用户现有记忆未修改。

## 1. 来源与适配边界

本轮重新计算了官方 Raft Computer 1.0.18 bundle SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，与冻结证据一致。

| 采用内容                                  | 来源/方式                                                                                                                       | 当前事实                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 索引、notes、Active Context、压缩恢复规则 | 两个 byte-exact memory prompt builder；原始 4,049 bytes，SHA `b47ccf545645f927d543aa377d50434b6d0982896c28d7794f1f90b801e97f83` | 本轮未改原文，回归重新校验 hash 和实际 prompt 正文                                       |
| Inbox check 不消费                        | bundle 的 `src/commands/inbox/check.ts`（729274 附近）、`createAgentAppInboxStore.list`（747084 后）                            | `agent inbox check` 只列出当前提示，不测量、不 ack、不自动重建                           |
| stable source identity、显式 ack          | `createAgentAppInboxStore.mint/ack`                                                                                             | 保留每 Agent transient hint；ack 是确认通知，不是模型工作证明                            |
| 版本保护和源重查                          | RAH 最小承载适配                                                                                                                | item/version 防止旧确认删除新提示；只有显式 `recheck` 或既有 timer/Activation 才重新测量 |
| 身份与传输                                | RAH 既有 private credential + CLI wrapper + Activation lease 复用                                                               | 独立 Computer-local capability，不复用 Room token、不挂 `/v1/worker` 路由                |

`check/ack` 属于结构化移植；版本保护、loopback listener、受控环境和 `recheck` 是明确标记的 RAH glue，不能统称“原源码逐字复制”。`recheck` 不改变默认读取或记忆组织方式，只提供可选的即时大小证据。

## 2. 已实现与实际验证

- 本机 v3/v4、remote profile composition 和 v2 compatibility 使用同一个 `prepareRuntimeActivation`。底层只生成 materialization receipt 的 `prepareActivation` 不额外创建网络能力。
- 每个 Run 得到随机独立 capability；token 只存在 owner-private 文件，环境/argv/wrapper 不包含 token 正文。实际 owner 从 Computer 的闭包绑定，CLI/HTTP payload 均不接受 owner/Room/cursor。
- `check` 不消费、不测量；`ack --item-id ID --version N` 明确返回 `notification_acknowledged_not_memory_cleaned`。确认后立即 check 不再产生提示；显式 recheck 或下个 timer 发现仍超限时可以再次提醒。
- `recheck` 使用既有安全测量和 10 秒边界；`under_threshold` 只证明大小，`not_established` 为未知。没有读取成功或模型完成的推断。
- HTTP 只监听 `127.0.0.1`，有独立鉴权、精确 Host 校验、拒绝 Origin、严格 command schema、4 KiB 请求体限制、固定路由和连接限制。无 CORS、无任意路径读取、无 Room API 转发。
- Run 释放和 Computer 关闭都会撤销 listener、回收凭据。已释放 wrapper 不再可用；在途请求被关闭。旧配置/旧提示确认不影响新版本。
- 实际子进程在写出 oversized index 后，通过 CLI 立即得到源测量；换 Room/Profile 后仍指向相同私有 memory。另一个 Agent 的查看不包含它，确认其 item 会失败。remote composition 的 CLI 在 Computer-local listener 成功执行，无需访问远程 Worker origin。
- 原文文件不被这些命令改写；启动索引仍是完整 Raft 原文件路径，没有新正文或索引格式。

相关 owner：`agent-memory-cleaner.ts`（通知状态）、`agent-memory-coordinator.ts`（Run 生命周期）、`agent-app-inbox-transport.ts`（私有传输）、`protocol/agent-app-inbox.ts`（命令 schema）。CLI 只是 facade，没有第二份 Inbox。

## 3. 本轮审计发现与处理

1. **已修复：同配置测量乱序。** 原来只有配置 revision fence；较早的慢测量能覆盖较新的结果。现增加每次测量 token，旧结果作废。显式 ack 同时作废在途旧测量，不能复活已确认提示。
2. **已修复：stable ID 的迟到确认。** 相同 source 的提示可能被删除后重新生成。新增 notification version，并在同步确认边界校验；旧版本无法确认新提示。version 不写进记忆文件。
3. **已修正：首版接入改变了 check 行为。** 第一版把测量隐含在 check 内，可能在 ack 后立即重新提醒。重新对照上游后撤回：默认只查看；测量为显式 recheck。反例测试确认修正前失败、修正后通过。
4. **已封住：新增保留环境值的伪造入口。** 父进程/静态 profile 中的 Inbox URL、token path、CLI path 在 GenericProcessAdapter 中清除，只有受控 Run lease 可以提供。
5. **明确不混淆：消失的通知不是清理证明。** 保留上游 transient 通知撤销语义，不能根据列表为空、exit 0、ack 成功推断记忆质量；需要独立源测量和模型语义验收。

## 4. 门禁与证据等级

本次执行均使用临时目录、隔离状态、假 Provider/真实 Node 子进程；没有调用付费模型。

- 定向 10 文件：58/58（初次接入）；收紧 check 后五文件链路回归 16/16。
- 最终 `npm run check`：TypeScript 通过；后端 **633 项，631 通过，2 项 opt-in 付费门禁跳过**；Web 单测 **25/25**。
- `npm run build:web`、`npm run format:check`、`git diff --check` 均通过。Web 构建仍提示主 chunk 超过 500 kB；本轮没有做 UI 分包优化，不将这个提醒表述为性能已验收。
- 日志目录：`/tmp/rah-memory-inbox-audit.hXRN3d/`：`red-read-only-check.log`、`targeted.log`、`refinement.log`、`remote-cli.log`、`check-final.log`、`web-build.log`、`format-final.log`、`diff-check.log`。

证据等级是 **E2：真实进程/传输/文件与 owner 闭环**，不是 E3 模型理解或 Raft 双边浏览器验收。本轮没有 UI 变更、没有浏览器验收，也未部署或自动升级冻结 RuntimeProfile。

## 5. 剩余项与必要性

后续源码研究已细化本表：[Raft 剩余能力复用与实施计划](../product/agent-memory-raft-completion-plan.zh-CN.md)。其中 idle 维护是完整生命周期项，active notice 是 Runtime 能力相关的可选投递；二者不再捆绑为同一开发前置条件。跨 Computer 迁移存在官网说明与 bundle 实现不一致的证据，后置不代表 Raft 没有该实现。本报告以上测试事实不变，后续计划也不算新增实现证据。

| 顺序 | 项目                                                                        | 必要性 / 当前判断                                                                                                     |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | 新 prompt 与冻结 RuntimeProfile 配对升级；真实模型跨 Room/DM 记忆形成与召回 | 发布前必需。旧常驻进程不会因为源码修改自动学会新命令，子进程脚本不证明模型遵守规则                                    |
| 2    | 独立 revision 的 cleaner 阈值配置与真实动作反馈                             | 最小闭环需要。当前 hint 的配置指引尚无运行内动作；需避免后续 Activation 用角色 revision 覆盖设置，不扩建通用 App 平台 |
| 3    | 与全局 Agent lane 共用 fence 的 idle maintenance、terminal proof/receipt    | 完整 Raft 生命周期对齐需要，但不阻塞第一轮跨对话记忆验收。不能伪造 Room wake 或开启第二 lane                          |
| 按需 | active safe notice、全量 notes hashing 的优化                               | notice 按具体 Runtime 能力后置，不支持则等自然结束/下次 Activation。扫描先测成本，未超预算不加缓存，不改记忆正文架构  |
| 后置 | 临时无记忆模式、跨 Computer handoff/远程 Human control                      | 都需要独立安全链路；不以 prompt 开关冒充强隔离，不阻塞当前本机基线实测                                                |

后续不增加分类层级、不把 cwd 变成记忆分库、不引入自动文本切分。先验证原框架在真实对话中有效，再决定是否需要可回退增强。
