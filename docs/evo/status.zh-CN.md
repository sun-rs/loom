# evo 分支现状（阶段 1 清理后）

日期：2026-09-24。本页是 evo 相对 `main`（`milestone-ui-raft` = `f1bc8c9`：5122795 加测试修复，全量检查通过）的唯一差异说明。
`docs/architecture`、`docs/product` 中的 owner 文档描述的是 main 基线；与本页冲突时，以本页和代码为准。
evo 的目标合同见 [target-contract](target-contract.zh-CN.md)（owner 2026-09-24 已签），效率门禁合同见 [cli-efficiency-gate](../design/cli-efficiency-gate.zh-CN.md)。

## 分支与环境

- `main`：冻结的 UI 里程碑，只接受紧急修复。worktree `~/Code/repos/loom-main`，当前不运行。
- `evo`：新后端开发线。前端（`apps/web`、`packages/ui-web`、`packages/ui-tokens/specs`）与 main 完全一致，本阶段不改前端。
- `ref/role-ui-draft`（= `789ffc6`）：Codex 9/21–9/23 的完整检查点，含 Role 前端草稿、全部审计文档与证据，仅作参考。
- 本地 evo 服务：端口 4176，launchd `com.loom.evo`，数据 `~/.loom/evo`。数据目录与路径绑定（挂载回执存绝对路径），不要搬迁。
- 旧正式环境（`~/.rah`、4173）已按 owner 决定退役，不再兼容旧数据。

## evo 代码相对 main 的改动

### 一、9/21 调度修复（schema 58）

- `worker-message-projection.ts`：message check 不再返回 18 类执行审计事件。
- `worker_message_presentations`：按消息的精确展示回执，替代高水位，用于忙时通知和"已展示"标注。
- 启动上下文瘦身为身份和范围（manifest 校验但不回显）。
- MEMORY.md 通过 `--prompt-file` 进入 Claude/Codex 原生 system 层（`startupMemoryTransport`，默认对 claude/codex 开启）。

### 二、Role / Instance MVP（schema 59–60）

- `role_templates` / `role_revisions` / `role_instances`；Role 修订不可变，实例冻结创建时的配置快照。
- 每个频道实例是独立 principal，拥有独立执行 lane 和 provider session；复用 Inbox/Activation/AgentHost。
- 实例私聊（私有 box）：与频道共用 session，忙时排队，频道运行读不到。
- 实例 session 连续性：稳定 session key（不含配置版本和提示词摘要）；四家驱动对实例禁止恢复失败后静默新建；绑定失败终止并隔离。
- 旧 Agent 路径仍然保留；按已签合同将在 evo 后端移除。

### 三、效率门禁脚本

`scripts/cli-efficiency/`、`scripts/test-cli-efficiency.mjs`、`scripts/scheduling-phase-audit.mjs`。

### 四、S1-a 用量观测（schema 61）

- `run_attempt_usage`：驱动经 fd3 `rah-provider-usage/v1` 帧逐次生成上报原生 token 用量（Codex/Claude/OpenCode；Kimi ACP 不提供逐次用量），Host 以自身凭据按 (RunAttempt, response) 幂等写入，不进 trajectory；`agent.run.usage.get` 按 RunAttempt 读取。

## 已知缺陷（待阶段 3 修复）

| 级别 | 问题                                                                                             | 位置                                                      |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| P1   | 首启在绑定前失败后被判为"已有历史但绑定丢失"，永久隔离                                           | `kernel/src/run-agent-context.ts:92`                      |
| P1   | 隔离后无出口：重置不清历史判断、界面无重建入口                                                   | `workspace-agent-management.ts:634`                       |
| P1   | 续聊实例收不到 Role 规则更新（Kimi 确认），启动上下文却报告新 revision                           | `kimi-acp-driver.mjs:297`、`worker-startup-context.ts:31` |
| P1   | 创建频道时可把已有实例加入第二个频道                                                             | `collaboration-service.ts:390`                            |
| P1   | 无 usage、上下文窗口、压缩次数观测                                                               | agent-host                                                |
| P1   | 服务端明确 404 被 worker CLI 描述为"状态未知、不要重发"，最终结论丢在草稿（新旧 Agent 都受影响） | `agent-host/src/worker-cli-error.ts:89`                   |
| P2   | 失效私聊的写入检查只挂在 postMessage，replyThread/转发/提醒未覆盖                                | `collaboration-service.ts:1556`                           |
| P2   | 线程写入者占用被当成永久错误隔离；远端 Host 连续性开关不生效                                     | driver / remote composition                               |
| P2   | 新实例首轮约 30 秒等待挂载发布（30 s 刷新周期）                                                  | `runtime-offer-publisher.ts`                              |

## 效率基线（2026-09-23，Codex `gpt-5.6-luna / low`，S1 的对照基准）

同一源文件快照、新 session 起步、第三轮前重启。

| 组/轮次 | 有效回复时间 | 模型生成次数 | 输入合计 | 首请求输入 |
| ------- | -----------: | -----------: | -------: | ---------: |
| 原生 P2 |       12.6 s |            1 |   20,051 |     20,051 |
| 原生 P3 |       14.1 s |            1 |   20,406 |     20,406 |
| Role P2 |       19.4 s |            3 |   96,636 |     31,602 |
| Role P3 |       21.9 s |            3 |  101,412 |     33,102 |

- 总输入约为原生的 4.8–5.0 倍：单次上下文约 1.6 倍 × 3 次生成（check → post → final）。
- 固定负担：RAH 常驻 developer 指令约 57,200 字符，原生约 8,500；其中 `agent-host/src/agent-memory-prompt.ts` 的 transport and safety bindings 段约 3.4 万字符。
- Role P1 最终结论未送达（上表 404 问题）；旧 Agent P1 违反"不建任务"要求。
- 原始收据与报告在 `ref/role-ui-draft` 的 `docs/audits/2026-09-23-cli-efficiency-gate.zh-CN.md`、`docs/audits/evidence/2026-09-23-cli-efficiency/receipt.json`。

## 历史文档

9/21–9/23 的约 26 篇 audit/design 与 evidence 目录已从 evo 树中移除，完整保留在 `ref/role-ui-draft` 分支。
