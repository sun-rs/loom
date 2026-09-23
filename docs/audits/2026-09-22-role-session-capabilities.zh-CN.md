# Role/Session 设计的能力与来源核查

日期：2026-09-22。只读源码与官方文档调查；没有调用付费模型，没有执行上游测试。配套 [设计 v0.1](../design/role-instance-session-v0.1.zh-CN.md)。

后续补证：[第一批技术验证](2026-09-22-role-session-validation.zh-CN.md)已定位 Kimi/OpenCode 原生 fork 及其不同边界；下表中的未完成项目为本次初始核查状态，后续补证优先。

## 当前 RAH 接线

| 能力           | 源码证据                                                                                                     | 结论边界                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Claude Guide   | `packages/agent-host/src/runtime-implementation-registry.ts:575`，nativeBusyInput/direct；stream-json driver | 已有接线；不是任意生成时刻都立即消费                                         |
| Codex Guide    | 同文件 `:752`；app-server driver                                                                             | 已有接线；应保留 turn 身份和结束竞态保护                                     |
| Kimi Guide     | `kimi-acp-driver.mjs` 使用 session/new、session/resume、session/prompt；registry 没有 nativeBusyInput        | 当前 ACP 接入不提供忙时 Guide；不能说 Kimi 本身不支持                        |
| OpenCode Guide | `opencode-server-driver.mjs`；registry 没有 nativeBusyInput                                                  | 当前 RAH 未接运行中追加；不能说 CLI 本身没有能力                             |
| 模型/effort    | Claude driver `:141–142` 参数；Codex driver `:151–153,208` 配置                                              | 已有实现，不重新发明；新实例身份合同仍须保证改档不会换 session               |
| session 恢复   | 四个 driver 的 resume 路径；`provider-session-store.ts:19`                                                   | 当前已有恢复；不能将每次启动进程等同丢失上下文                               |
| session key    | participant/provider/runtimeProfileRevision/standingPromptDigest/workspaceMountRevision                      | 当前配置修订参与查找；新方案需绑定实例持续 session，不能直接沿用为新身份合同 |

这里读取的是带既有未提交变更的工作树，不声称对应某个已部署 commit。没有修改这些源文件。

## 版本固定的既有 Guide 证据

完整路径、版本、上游测试与边界见 [09-11 来源矩阵](2026-09-11-runtime-wait-guide-source-matrix.zh-CN.md)。本轮重新读取该矩阵，并核对当前 RAH 接线；未重新跑真实模型。

- Kimi Code commit `5efca0c3116743855c28426000073bfe34a4862f`：SDK session.steer，以及自带本地服务 prompts steer；ACP active prompt 拒绝第二次 prompt。扩展应评估已有安装服务，不能先要求安装另一套 CLI。
- OpenCode commit `3104c1428ec91f809e5ab86631300de41eb6952e`：运行中保存新 user message、后续 loop 读取的源码和测试证据。它与独立 turn/steer 的确认语义不相同，不能未经适配直接启用。
- Codex commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`：turn/steer 对 active turn 和 expectedTurnId 校验。当前本地上游测试文件 `codex-rs/app-server/tests/suite/v2/thread_fork.rs` 还包含 ephemeral fork 的 pathless/listing 测试；读过测试不代表本机运行通过。

## Fork 与 Side

| Runtime         | 可靠证据                                                                                                                      | v0.1 裁决                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Codex           | [官方 app-server](https://learn.chatgpt.com/docs/app-server) 定义 thread/fork、截止 turn、ephemeral；本地固定版本也有相关测试 | 可作为原生实现基础；仍需本机协议版本和 RAH 绑定/权限验收                |
| Claude Code     | [官方 CLI reference](https://code.claude.com/docs/en/cli-reference) 定义 resume/continue 配合 fork-session 创建新 ID          | 持久 fork 有依据；不据此宣称临时 Side、权限隔离和 system 身份覆盖已完成 |
| Kimi / OpenCode | 本轮没有形成完整的 fork/临时隔离、权限及崩溃恢复证据链                                                                        | 待验证，不承诺靠复制文件自动兼容                                        |

Codex 文档说明可指定已完成 turn 截止点，拒绝进行中的截止 turn；临时 fork 不进入存储列表。这支持 Side 的候选实现，但不能推出共享文件或记忆不可写。Claude 的 [记忆文档](https://code.claude.com/docs/en/memory) 没有给出本设计所需的 Side 写入隔离合同。**后续用户已确认 Side 可读已授权记忆、禁止写记忆。这是本产品的明确合同，不是声称已复制官方规则；实际隔离仍待验证。**

原生 fork 可能复制旧工具配置/上下文中的凭据；必须用新平台执行身份和撤销机制保证不能冒用源实例。复制 JSONL 不是通用兼容方案，可能遗漏索引、分支元数据、权限、认证路由与数据库记录。

## Raft 对照

留存 Raft Computer 1.0.32，darwin-arm64 发布包 SHA256 `0db97964b6f21d500629e14a88fe4d24b94476428d01de997863ad2d7545aec5`。提取来源：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.32/`；下述位置在 `slices/packages/daemon/dist/chunk-TEGPBMW7.js`。来源为官方发布包，只读分析，无源码复制进入产品。

| 位置             | 观察                                                  | 设计取舍                                                                                                                 |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 32088、31988     | Agent 运行/启动和已有 session 管理                    | 新方案有意改变为频道实例 session，不再跨频道共用 Agent 工作上下文                                                        |
| 24839、25497     | Claude/Codex persistent driver 与追加能力             | 保留恢复和原生控制面；常驻是传输选择，不等于业务正确性                                                                   |
| 27094、27705     | Kimi direct；OpenCode per_turn/defer                  | 不能将 Raft 未接某能力解释成原生不支持                                                                                   |
| 36349–36530      | busy notice 就绪、退避、压缩/review、去重和绑定 fence | 复用这些防护思路；该发送函数没有 Human-only 筛选，不能断言 Raft 全链路只让用户 steer，服务器上游投递政策仍不在此证据范围 |
| 36029、3180–3201 | 压缩事件及记忆/压缩安全提示                           | 保留观测和按需记忆；不把提示词当作压缩无损保证                                                                           |

本稿的 Human-only 主动 Guide 是用户确认的产品策略，不冒称 Raft 字节级复刻。Multica 的既有 Execute/Messages/Result 及等待路径见上述 09-11 矩阵；它提供等待/恢复参照，不能证明通用 Side/Fork 已实现。

## 记忆依据及不应过度推导的部分

- [LangGraph memory 概念](https://docs.langchain.com/oss/python/concepts/memory)：长期存储与会话状态分离，可为跨 session 记忆提供模型；namespace 不自动解决业务授权。
- [Letta MemFS](https://github.com/letta-ai/letta-docs-md/blob/main/concepts/memfs/index.md)：文件、按需读取和版本化值得参考；不能把特定产品的 agent 仓库归属直接变成 RAH 唯一政策。
- [Mem0](https://github.com/mem0ai/mem0)：身份过滤和记忆 API 提供实现参照；不是采用某 SDK 就完成权限隔离。
- [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：按需上下文与结构化笔记支持减少无关注入；不意味着记忆能恢复所有原始工作细节。

这组资料支撑“独立长期记忆 + 有界入口 + 按需正文”的候选结构，不能证明哪个默认授权范围或写入策略最适合本产品。此处保留建议和待验收界限。
