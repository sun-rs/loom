# 核心链路验收协议：五个真实使用场景

状态：本文只定义验收流程，不提出修复方案、不提出设计。产品核心为聊天室、私聊、Agent 配置与记忆系统；Raft 对齐工程已完成 Agent 侧表面，但下述五个真实使用场景从未端到端跑过。本协议给出可重复执行的标准场景与预期结果，供 Human 在工作台执行，或交给 Agent 执行。

**一切预期结果必须从持久证据判定。** 模型自述、CLI 轨迹文本、Agent 的散文总结都不是证据。历史教训：曾有模型声称“CLI 崩溃了两次”，而账本显示只有一次干净运行。凡本文写明“证据来源”的行，只以该来源判定；凡找不到持久证据的检查项，本文明确标注为“无持久证据”，不得以任何列名代替。

---

## 执行须知

### 授权付费模型

按 `AGENTS.md` 的 “Authorized paid CLI gate models (2026-09-09)”，本协议只允许下列组合，且必须断言这些精确的 catalog binding id 与 reasoning 等级，不得静默替换：

| CLI         | Model binding id             | Reasoning |
| ----------- | ---------------------------- | --------- |
| Claude Code | `sonnet`                     | `low`     |
| Codex       | `gpt-5.6-luna`               | `low`     |
| OpenCode    | `deepseek/deepseek-v4-flash` | `low`     |
| Kimi CLI    | `kimi-code/k3`               | `high`    |

**任何情况下不得运行 Fable。** binding id 以已安装 CLI 实际发布的为准，不得臆造版本后缀。

### 花钱与授权

每一次完整跑动都会真实调用付费 CLI，必须先取得 Owner 明确的开跑许可。该许可只覆盖本次跑动，不覆盖提交、推送或后续任何付费运行。开跑前先确认哪些场景可由已有确定性测试覆盖（见各场景末尾“已有的自动覆盖”），能跳过的就跳过，不重复花钱。

### 隔离实例（默认）

除非场景显式要求，全部在隔离实例上跑。隔离方式是给一个独立的数据根：

```sh
export RAH_DATA_HOME=/Users/sun/Code/reviews/rah_os/<日期>-<主题>/home
npm run start:local-workbench   # 默认 RAH_WEB_PORT=4173，可另设
```

`resolveRahDataHome()`（`packages/daemon/src/rah-data-home.ts`）以 `RAH_DATA_HOME` 为准，缺省才回落到 `~/.rah`；`RAH_DATA_HOME` 与 `RAH_OS_HOME` 同时设置且不一致会直接抛错。隔离实例的账本在 `$RAH_DATA_HOME/state/room.db`，运行时注册表在 `$RAH_DATA_HOME/state/runtime-registry.db`，Agent 记忆在 `$RAH_DATA_HOME/state/supervisors/agent-memory/`。隔离实例使用真实付费 CLI，因此仍然花钱。

### 何时必须用正式实例

只有当验收目标本身是“正式实例上既有的 Agent 身份、既有记忆、既有 Room 历史”时才用正式实例，即场景五的“更正旧事实后新会话正确召回”若要针对已积累记忆的真实身份验证，以及场景四要求验证正式实例重启恢复时。其余场景一律隔离。

用正式实例前必须先备份，并且只能在完全空闲时重启：

```sh
node scripts/restart-local-workbench.mjs --pid <现役 pid> --state /Users/sun/.rah/state --build <精确 Web build id> [--port 4173]
```

该脚本按 `scripts/workbench-restart-guard.mjs` 的顺序执行 validate → inspect → backup → verify → recheck → stop：`assertWorkbenchIdle(db)` 要求 `activations` 无 `queued/leased/quarantined`、`run_attempts` 无 `starting/running/orphaned`、`runtime_processes` 无非 `terminated`、`placements` 无非 `released`、`agent_exclusive_operation_leases` 无 `active`，否则拒绝重启；`backupState` 把整个 `state/` 逐文件备份到 `~/.rah/backups/pre-restart-<uuid>/`（`.db` 走 SQLite backup 并做 `PRAGMA quick_check` / `foreign_key_check`，WAL/SHM 侧车不备份），收据写到 `~/.rah/backups/pre-restart-<uuid>.receipt.json`。已有历史备份目录同在 `~/.rah/backups/`（如 `formal-pre-*`）。

2026-09-14 起，重启还校验现役启动收据并保留网络模式，防止手机入口丢失。无收据的旧实例需核对原网络配置后显式迁移；参见[网络重启恢复](../audits/2026-09-14-pwa-network-restart-recovery.zh-CN.md)。验收必须覆盖原 PWA 网络地址，不能仅检查 loopback。

**不要绕过这条路径手工 kill 正式实例。** 备份失败、非空闲、build id 不匹配时脚本会拒绝，这就是正确结果。

### 读取账本

```sh
sqlite3 -readonly "$RAH_DATA_HOME/state/room.db" "<SQL>"
```

正式实例路径为 `/Users/sun/.rah/state/room.db`。注意 `~/.rah/room.db` 是一个 0 字节的历史遗留文件，**不是账本**，读它会得到空结果。必须只读打开，不要在跑动中写库。

### 浏览器与 API

Human 步骤可在 Web UI 完成，也可直接调 client API（前缀 `/v3/client`，见 `packages/application-service/src/client-application-service.ts`）。本文每一步给出 UI 动作与对应路由，二者等价：`/rooms/create`、`/rooms/members/add`、`/rooms/sync`、`/messages/post`、`/threads/create`、`/threads/reply`、`/rooms/direct/open`、`/rooms/sos/stop`、`/rooms/sos/resume`、`/tasks/workflow`、`/agents/provision`、`/agents/onboard`、`/agents/manage`、`/agents/list`、`/agents/memory/read`、`/agents/trajectory/list`；运行时目录为 `/v1/local/runtimes/list`。

---

## 通用证据词表

下列表名与列名均已在实机 `room.db`（82 张表）核对存在，可直接引用：

| 对象                                                        | 用途                    | 关键列                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room_events`                                               | Room 权威事件日志       | `event_id`、`room_id`、`room_seq`、`type`、`actor_id`、`aggregate_type`、`aggregate_id`、`payload_json`、`idempotency_key`、`created_at`                                                                                                                      |
| `messages`                                                  | 消息正文                | `message_id`、`room_id`、`actor_id`、`thread_id`、`body`、`created_at`                                                                                                                                                                                        |
| `threads`                                                   | Thread                  | `thread_id`、`room_id`、`root_message_id`、`reply_count`、`last_reply_at`                                                                                                                                                                                     |
| `memberships`                                               | 参与范围                | `room_id`、`principal_id`、`role`                                                                                                                                                                                                                             |
| `direct_room_pairs`                                         | DM 规范配对             | `workspace_id`、`left_principal_id`、`right_principal_id`、`room_id`（UNIQUE）                                                                                                                                                                                |
| `inbox_items`                                               | 投递                    | `participant_id`、`event_id`、`event_seq`、`reason`、`state`（`pending`/`acknowledged`），UNIQUE(`participant_id`,`event_id`)                                                                                                                                 |
| `activations`                                               | 唤醒                    | `activation_id`、`participant_id`、`from_seq`、`to_seq`、`reason`、`state`（`queued`/`leased`/`quarantined`/`completed`/`cancelled`）、`attempt_count`、`last_error`                                                                                          |
| `run_attempts`                                              | 执行                    | `run_attempt_id`、`placement_id`、`activation_id`、`attempt_number`、`state`（`starting`/`running`/`orphaned`/`exited`/`failed`/`cancelled`/`timed_out`）、`exit_code`、`exit_signal`、`error`、`started_at`、`finished_at`                                   |
| `placements`                                                | 冻结的执行决定          | `placement_id`、`activation_id`、`agent_definition_revision_id`、`execution_policy_revision_id`、`runtime_profile_revision_id`、`state`、`decision_json`                                                                                                      |
| `runtime_processes`                                         | 进程与恢复              | `run_attempt_id`（UNIQUE）、`runtime_run_id`、`state`（`prepared`/`active`/`orphaned`/`terminated`）、`recovery_driver`、`recovery_descriptor_json`、`exit_code`                                                                                              |
| `run_trajectory_entries`                                    | 诊断轨迹                | `activity_id`、`run_attempt_id`、`runtime_run_id`、`producer_sequence`、`entry_json`（`$.kind` ∈ `status`/`text`/`tool_start`/`thinking`）                                                                                                                    |
| `held_message_drafts`                                       | 忙时暂缓                | `held_draft_id`、`participant_id`、`activation_id`、`thread_id`、`body`、`based_on_room_seq`、`seen_up_to_seq`、`state`（`held`/`replaced`）、`rehold_count`、`resolution_kind`（`expired`/`reheld`/`revised`/`sent_anyway`/`sent_unchanged`）、`resolved_at` |
| `worker_target_read_positions`                              | Kernel 持有的已呈现位置 | `participant_id`、`room_id`、`thread_key`（Room 级为空串 `''`）、`through_room_seq`、`read_order`                                                                                                                                                             |
| `tasks`                                                     | 任务                    | `task_id`、`task_number`、`room_id`、`creator_id`、`assignee_id`、`claimed_by`、`thread_id`、`source_message_id`、`state`、`workflow_status`                                                                                                                  |
| `room_agent_sos_operations` / `_holds` / `_targets`         | Room 级停止             | `state`（`stopping`/`stopped`/`resumed`）、`requested_by`、`guidance`；targets 的 `activation_id`、`activation_attempt_number`、`state`（`requested`/`terminal_proven`）                                                                                      |
| `agent_definition_revisions` / `execution_policy_revisions` | 配置版本                | `agent_definition_revision_id`、`definition_json`、`execution_policy_revision_id`；`policy_json`（`$.modelIntent.exactBindingIds`、`$.modelIntent.reasoning`、`$.required.allowedOfferIds`）                                                                  |
| `agent_memory_homes`                                        | 记忆归属 Computer       | `participant_id`、`owner_host_id`、`state`（`bound`/`conflicted`）、`bound_at`                                                                                                                                                                                |
| `context_manifests`                                         | 每次 Run 的上下文审计   | `run_attempt_id`（UNIQUE）、`content_digest`、`manifest_json`                                                                                                                                                                                                 |
| `activation_retry_fences`                                   | 重试围栏                | `activation_id`、`state`（`observing`/`blocked`/`resolved`）、`retry_disposition`、`error_fingerprint`、`same_error_count`                                                                                                                                    |

`activations.reason` 与 `inbox_items.reason` 的合法取值（`packages/protocol/src/activation.ts`）：`mention`、`dm`、`task_assigned`、`task_available`、`task_collaboration`、`task_review`、`task_updated`、`dependency_resolved`、`input_requested`、`input_resolved`、`thread_subscription`、`reminder`、`room_policy`、`manual`。

文件系统证据：

- Agent 私有记忆目录 `<dataHome>/state/supervisors/agent-memory/<sha256(participantId)>/`，内含 `MEMORY.md`（0600）与 `notes/`（0700）。目录名只由 `participantId` 派生（`agentMemoryWorkspacePath()`，`packages/agent-host/src/agent-memory-workspace.ts`），与模型、effort、Room、cwd 无关。
- 记忆物化收据 `<memoryRoot>/.materialization-receipts/<sha256(runAttemptId)>.json`，含 `runAttemptId`、`activationId`、`ownerParticipantId`、`schemaVersion`（2 = index-only）与逐文件摘要。**收据只证明物化，不证明模型读过。**
- 进程事实：`ps -o command= -p <pid>`；`ps eww <supervisor-pid>` 可读到 `RAH_PROCESS_SUPERVISOR_CONFIG`，其中含子进程精确的 `{command, args}`。每个子进程都带 `RAH_RUN_ATTEMPT_ID`、`RAH_ACTIVATION_ID`、`RAH_PARTICIPANT_ID`、`RAH_ROOM_ID`，可把 pid 反向 join 回账本。

---

## 场景一：Room A 多 Agent 协作

### 前置

- 隔离实例。
- 一个 Room A，一个 Human，三个 Agent：`exec-a`（执行）、`audit-b`（审计）、`bystander-c`（在 Room 内但本轮不被 @）。三者按授权矩阵各自绑定不同 CLI（建议 `exec-a`=Codex `gpt-5.6-luna` low、`audit-b`=Kimi `kimi-code/k3` high、`bystander-c`=OpenCode `deepseek/deepseek-v4-flash` low）。
- 配置由 `/agents/provision` + `/agents/onboard`（或 UI 的 Agent 运行时对话框）落盘；开跑前先用 `/v1/local/runtimes/list` 确认目标 binding id 与 reasoning 在实机 catalog 中真实存在。
- 无预置 Task，Room 无历史消息。

### 步骤

1. Human 在 Room A 顶层发一条分工消息，正文精确为：

   ```
   @exec-a 请建立 acceptance/S1.txt，内容一行 S1 EXEC OK。做完在本房间报告。
   @audit-b 请审计 exec-a 的这次工作：只看它留下的证据，不要自己动手做，也不要认领任务。
   ```

   （UI：Room A 顶层输入框；API：`/messages/post`，`threadId` 留空。）

2. 等待第一轮两边都各发过一次。用 `activations` 确认两个 Agent 各自的 Activation 已 `completed`。

3. Human 再发一条，要求持续多轮并给出停止条件，正文精确为：

   ```
   @exec-a @audit-b 继续三轮：exec-a 每轮把 acceptance/S1.txt 追加一行 ROUND n，audit-b 每轮核对行数并说明依据。第三轮结束后双方都停止，不要再发言。
   ```

4. **制造忙时窗口。** 在 `exec-a` 正在跑的时候追加消息。制造方式：在第 3 步的消息里已要求 `exec-a` 逐轮写文件；执行者要确认忙时窗口，必须以账本判定，不能靠计时——查询

   ```sql
   SELECT run_attempt_id, state FROM run_attempts
    WHERE participant_id = '<exec-a>' AND state = 'running';
   ```

   返回非空时（可再叠加工作区标记文件存在作为第二个条件），立刻发送追加消息，正文精确为：

   ```
   @exec-a 插一个独立问题：acceptance/S1.txt 现在有几行？只回答行数。
   ```

5. **多 Thread 并行。** 对第 1 步的 Human 消息建 Thread X（`/threads/create`），在其中回复：

   ```
   @exec-a 在这个 Thread 里回答：X 分支的答案是什么？只在本 Thread 回。
   ```

   对第 3 步的 Human 消息建 Thread Y，在其中回复：

   ```
   @audit-b 在这个 Thread 里回答：Y 分支的结论是什么？只在本 Thread 回。
   ```

   两条在 60 秒内先后发出，不等第一条完成。

6. **目标达成后中断。** 第三轮结束后，若任一 Agent 仍在发言，Human 执行 Room 级停止（UI：Room 停止按钮；API：`/rooms/sos/stop`），随后 `/rooms/sos/resume` 恢复。若双方按停止条件自行停下，则记录“未触发 SOS”，并仍执行一次 `/rooms/sos/stop` + `/rooms/sos/resume` 以验证该路径。

7. 全部静默后（`activations` 无非终态、`run_attempts` 无活动态、`runtime_processes` 全 `terminated`），采集证据。

### 观察点与预期结果

| #    | 检查项                                                | 预期结果                                                                                                                                                                                                        | 证据来源                                                                                            |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1.1  | 两个被 @ 的 Agent 都收到了第 1 步消息                 | `exec-a`、`audit-b` 各有一条 `reason='mention'` 的投递                                                                                                                                                          | `inbox_items.reason` where `event_id` = 第 1 步 `message.posted` 的 `room_events.event_id`          |
| 1.2  | 未被 @ 的 Room 成员按 Room 策略也收到                 | `bystander-c` 对同一 `event_id` 有一条 `reason='room_policy'`                                                                                                                                                   | `inbox_items.reason`、`inbox_items.participant_id`                                                  |
| 1.3  | 无漏回复                                              | 每一条 Human 消息的 `event_id`，对每个被 @ 的 participant 都存在 `inbox_items` 行，且其 `state='acknowledged'`                                                                                                  | `inbox_items.state`、`inbox_items.acknowledged_at`                                                  |
| 1.4  | 无重复唤醒                                            | 同一 `(participant_id, event_id)` 只有一行（表级 UNIQUE 保证）；且不存在两条 `activations` 的 `[from_seq,to_seq]` 区间对同一 participant 重叠                                                                   | `inbox_items` UNIQUE(`participant_id`,`event_id`)；`activations.from_seq`/`to_seq`/`participant_id` |
| 1.5  | 回复不串线                                            | Thread X 内的 Agent 消息 `thread_id` = Thread X，Thread Y 内的 = Thread Y；顶层轮次消息 `thread_id IS NULL`                                                                                                     | `messages.thread_id`、`messages.actor_id`                                                           |
| 1.6  | Thread X 只被 `exec-a` 回、Thread Y 只被 `audit-b` 回 | Thread X 内不存在 `actor_id='<audit-b>'` 的消息，反之亦然                                                                                                                                                       | `messages.thread_id` + `messages.actor_id`                                                          |
| 1.7  | 审计者不认领任务                                      | 不存在 `actor_id='<audit-b>'` 的 `task.claimed` 事件；`tasks` 中无 `claimed_by='<audit-b>'`                                                                                                                     | `room_events.type='task.claimed'` + `actor_id`；`tasks.claimed_by`                                  |
| 1.8  | 审计者的结论有据                                      | `audit-b` 的消息正文引用了 `exec-a` 留下的可核对事实（文件行数或 `run_attempts` 事实）；执行者人工比对，**该项无机器判定的持久证据**，只作观察记录                                                              | `messages.body`（人工判读，不作为通过/失败硬条件）                                                  |
| 1.9  | 忙时追加消息最终得到答复                              | 忙时追加问题在静默后存在一条对应的 `exec-a` 消息                                                                                                                                                                | `messages.body`、`messages.actor_id`、`messages.created_at`                                         |
| 1.10 | 忙时原回复不丢                                        | 第 3 步轮次的原始结论与第 4 步追加问题的答复**都**存在；若发生暂缓，`held_message_drafts` 中该 participant 的行以 `resolution_kind='sent_unchanged'` 或 `'sent_anyway'` 结束，而不是 `'revised'` 或 `'expired'` | `held_message_drafts.resolution_kind`、`.state`、`.body`；`messages.body`                           |
| 1.11 | 冻结 Activation 上界符合实现                          | 忙时新消息不注入当前 Activation，而是产生新的一条 `activations`，其 `from_seq` = 追加消息的 `room_seq`                                                                                                          | `activations.from_seq`/`to_seq`；`room_events.room_seq`                                             |
| 1.12 | 已呈现位置前进                                        | `worker_target_read_positions.through_room_seq` 至少推进到追加消息的 `room_seq`                                                                                                                                 | `worker_target_read_positions`（`participant_id`,`room_id`,`thread_key=''`）                        |
| 1.13 | 停止生效                                              | `/rooms/sos/stop` 后 `room_agent_sos_operations.state` 走到 `'stopped'`，每个目标 `room_agent_sos_targets.state='terminal_proven'`；`/rooms/sos/resume` 后 `state='resumed'` 且 `guidance` 非空                 | `room_agent_sos_operations.state`/`guidance`；`room_agent_sos_targets.state`                        |
| 1.14 | 基础设施干净                                          | 所有 `activations.state` ∈ {`completed`,`cancelled`}；所有 `run_attempts.exit_code = 0`（被 SOS 终止的除外，记录其 `state` 与 `exit_signal`）；`runtime_processes.state` 全为 `terminated`                      | `activations.state`；`run_attempts.state`/`exit_code`/`exit_signal`；`runtime_processes.state`      |

### 失败判据

- **漏回复**：存在某条被 @ 的 Human 消息，其 `inbox_items` 行长期停留在 `state='pending'`，或该 participant 在静默后没有任何 `created_at` 晚于该消息的 `messages` 行。
- **重复唤醒**：同一 participant 出现两条 `activations`，其 `[from_seq, to_seq]` 区间覆盖同一个 `room_seq`，且两条都产生了实际发言。
- **回复串线**：某 Agent 的消息 `thread_id` 与其被要求回复的 Thread 不一致；或应答内容出现在另一个 Thread 的 `messages.body` 中。
- **忙时原回复丢失**：`held_message_drafts` 中存在 `state='replaced'` 且 `resolution_kind='revised'` 的行，而该行 `body` 中的实质结论在 `messages` 中找不到对应正文。
- **停止不生效**：`room_agent_sos_operations.state` 停在 `'stopping'`，或存在 `room_agent_sos_targets.state='requested'` 长期不转 `terminal_proven`；或 SOS 之后仍出现新的 `messages` 行。
- 任一 `run_attempts.state` 为 `failed`/`timed_out` 且 `error` 非空而未被本次场景显式预期。

### 已有的自动覆盖

- `packages/daemon/test/agent-task-split-chain.test.ts`（确定性，Fake CLI）已机器验证：lead 拆分子任务并带归属、`payload.recipients` 恰为两个 `mention` + 一个 `room_policy`、helper 的唤醒 `reason='task_available'`（直接 SQL 查 `inbox_items.reason`）、普通 Agent 被 @ 做审计时在正确 `threadId` 内作答且**从不认领任务**、驳回—返工—通过的完整事件序列、服务端派生 `idempotency_key`、blocked 父任务跨 Run 恢复时 `runAttemptId` 不同、重启后 3 个任务全部持久。→ 覆盖 1.1、1.2、1.7 的机制，以及“审计者不动手”的结构面。
- `packages/daemon/test/busy-hold-recovery-chain.test.ts`（确定性，Fake CLI，用 barrier 文件而非计时器制造真实忙态）已机器验证：Agent 发言正文恰为 `[原结论, 追加答复]` 且顺序正确；暂缓时 CLI 返回非零并在 stdout 给出 `SEND_HELD_AS_DRAFT` 指引；`message-post --send-draft --target '#room'` 仅凭 target 即可恢复原草稿；重启后正文不变。→ 覆盖 1.10 的核心机制。
- `packages/daemon/test/presented-context-second-activation.test.ts`（确定性）已机器验证：恰好 2 个 Activation、第二个 `from_seq === to_seq ===` 追加消息的 `room_seq`、`worker_target_read_positions.through_room_seq` 推进到该 seq、sync 文本明确写出“已呈现/已回答”。→ 覆盖 1.11、1.12。
- `packages/daemon/test/real-agent-split-chain-gate.test.ts`（付费，`RAH_REAL_SPLIT_CHAIN_GATE=1`，Codex `gpt-5.6-luna` low + Kimi `kimi-code/k3` high + OpenCode `deepseek/deepseek-v4-flash` low，超时 12 分钟，三个付费 CLI 并发，最贵）已用真实模型验证：两个子任务分别落到被点名的 helper、恰好一条同时 @ 两人的顶层消息、父任务归属与 `blocked` 状态、工作区里真实产出 `SPLIT_A.txt`/`SPLIT_B.txt`、返工后提交次数 1→2、父任务由**新的**执行恢复且不产生替身父任务、重启后持久。开跑前它会核对 catalog 中确有该 `modelId` 且 `supportedReasoning` 含授权等级，并以 `exactBindingIds` + `fallback:"disabled"` 钉死花销。→ 本场景的“多 Agent 分工 + 审计 + 返工”若已跑过该 gate，可跳过第 1—3 步的重复花费，只补跑忙时与多 Thread 部分。
- `packages/daemon/test/real-busy-hold-gate.test.ts`（付费，`RAH_REAL_BUSY_HOLD_GATE=1`，`RAH_REAL_BUSY_HOLD_CLI` 取 `opencode`（默认）或 `kimi`，超时 10 分钟，单 CLI 两轮，最便宜）已用真实模型验证：忙态从账本判定（`run_attempts.state='running'` 且工作区标记文件存在，不用计时器）、两条业务标记各恰好出现一次、所有 Activation 终态、所有 `exit_code=0`，并且直接查 `held_message_drafts` 断言至少一行 `resolution_kind='sent_unchanged'`——只有 `--send-draft` 会产生该值。注意其 `RAH_REAL_BUSY_HOLD_WORDING=ambiguous` 变体是**只观察不断言**的，因为 2026-09-09 的三次跑动中两个模型都在含糊措辞下主动替换了暂缓草稿。→ 覆盖 1.10；本场景第 4 步可视为该 gate 在多 Agent 环境下的扩展。
- `packages/daemon/test/real-role-contrast-gate.test.ts`（付费，`RAH_REAL_ROLE_CONTRAST_GATE=1`，Kimi `kimi-code/k3` high 与 OpenCode `deepseek/deepseek-v4-flash` low 各一执行者一审计者，四个 Agent 各自独立 Room，超时 10 分钟）**只硬断言基础设施**：`timedOut === false`、每个 Agent 至少一个 Activation 且全部 `completed`/`quarantined`、至少一个 `exit_code === 0` 的 RunAttempt、至少一条发言；执行者/审计者的行为差异（是否改了工作区文件、发言中是否出现审计信号）只写进报告，**不断言**。→ 覆盖 1.14 与“执行/审计角色对照”的可观察面；1.8 的质量判断在该 gate 里同样是人工判读，与本协议一致。

---

## 场景二：跨 Room 协作

### 前置

- 承接场景一的同一隔离实例与同一批 Agent 身份（**不要新建身份**，跨 Room 的意义在于同一 participant）。
- 新建 Room B，只把 `exec-a` 与 `audit-b` 加入，`bystander-c` 不加入。
- Room A 保持存在且有历史。

### 步骤

1. Human 建 Room B（`/rooms/create`），加入 `exec-a`、`audit-b`（`/rooms/members/add`）。

2. 在 Room B 顶层发：

   ```
   @exec-a 这是 Room B。请只用一句话说明你在这个房间要做什么，不要引用其他房间的内容。
   ```

3. 在 Room B 顶层再发一条只 @ `audit-b` 的消息：

   ```
   @audit-b 请在 Room B 里确认：exec-a 刚才说了什么？
   ```

4. **跨 Room 记忆尝试。** 在 Room B 顶层发：

   ```
   @exec-a 请回忆你在另一个房间为我建立的文件叫什么名字，并说明你是从哪里读到的。
   ```

5. 回到 Room A 顶层发：

   ```
   @exec-a 你现在同时在两个房间。请只回答：你在 Room B 说的那句话是什么？
   ```

6. 静默后采集证据。

### 观察点与预期结果

| #    | 检查项                      | 预期结果                                                                                                                                                                                                       | 证据来源                                                                                                                                           |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | 参与范围正确                | Room B 的 `memberships` 恰含 Human、`exec-a`、`audit-b`；不含 `bystander-c`                                                                                                                                    | `memberships.room_id`/`principal_id`/`role`                                                                                                        |
| 2.2  | 非成员不被投递              | 不存在 `participant_id='<bystander-c>'` 且 `room_id='<Room B>'` 的 `inbox_items` 行                                                                                                                            | `inbox_items.participant_id` + 关联 `room_events.room_id`                                                                                          |
| 2.3  | 非成员不被唤醒              | 不存在 `room_id='<Room B>'` 且 `participant_id='<bystander-c>'` 的 `activations`                                                                                                                               | `activations.room_id`/`participant_id`                                                                                                             |
| 2.4  | 消息寻址正确                | 第 2 步只给 `exec-a` 一条 `reason='mention'`，第 3 步只给 `audit-b` 一条                                                                                                                                       | `inbox_items.reason` + `event_id`                                                                                                                  |
| 2.5  | 上下文归属不跨房间泄漏      | Room B 的 Agent 消息 `room_id` 全为 Room B；Room A 的全为 Room A；不存在同一 `message_id` 出现在两个 Room                                                                                                      | `messages.room_id`、`messages.message_id`                                                                                                          |
| 2.6  | Activation 区间按 Room 独立 | 每条 `activations` 的 `from_seq`/`to_seq` 只落在其自身 `room_id` 的 `room_events.room_seq` 值域内                                                                                                              | `activations.room_id`/`from_seq`/`to_seq` 对 `room_events.room_id`/`room_seq`                                                                      |
| 2.7  | 读取位置按 Room 独立        | `worker_target_read_positions` 对同一 `participant_id` 存在两行，`room_id` 分别为 Room A 与 Room B，`through_room_seq` 互不影响                                                                                | `worker_target_read_positions.participant_id`/`room_id`/`through_room_seq`                                                                         |
| 2.8  | 记忆目录不因新 Room 变化    | `exec-a` 的记忆目录仍是 `<dataHome>/state/supervisors/agent-memory/<sha256(participantId)>/`，与场景一同一路径；目录未被重建（`MEMORY.md` 的 mtime/inode 与场景一后一致或只被追加）                            | 文件系统；`agentMemoryWorkspacePath()` 只由 `participantId` 派生                                                                                   |
| 2.9  | 跨 Room 召回本身            | 第 4 步的答复内容是否召回，属于模型行为，判定依据是记忆文件内容与其消息正文的比对；**账本中没有“本次 Run 读过记忆”的列**，只能用 `<memoryRoot>/.materialization-receipts/<sha256(runAttemptId)>.json` 证明物化 | 文件系统收据 + `messages.body`（人工比对）；`context_manifests.manifest_json` 中只有 `agentDefinition.memoryPolicyRef`，**不含记忆内容或读取记录** |
| 2.10 | 双 Room 并存不互相阻塞      | 两个 Room 的 `run_attempts` 可各自完成，`exit_code=0`；不存在因另一 Room 的 placement 导致的 `release_reason` 异常                                                                                             | `run_attempts.room_id`/`exit_code`；`placements.state`/`release_reason`                                                                            |

### 失败判据

- Room B 的任何事件为 `bystander-c` 生成了 `inbox_items` 或 `activations` 行。
- Agent 在 Room B 的回复出现在 Room A 的 `messages`（或反向），即 `messages.room_id` 与被要求作答的 Room 不一致。
- `worker_target_read_positions` 中某个 Room 的 `through_room_seq` 被另一个 Room 的 seq 覆盖（跨 Room 序号污染）。
- `exec-a` 的记忆目录在加入 Room B 后变成了不同的 `<sha256>` 路径，或出现了第二个目录。
- 2.9 不构成失败判据的硬条件：模型是否真的召回属于观察记录，不得据以判定链路缺陷；只有当记忆目录/收据本身缺失或指向错误 owner 时才算失败。

### 已有的自动覆盖

- `packages/daemon/test/agent-memory-runtime-continuity.test.ts` 已机器验证：同一 participant 在 `room-alpha` 写入的记忆，在 `room-beta` 用**不同 RuntimeProfile/模型**跑时，`memoryDirectory`、`memoryIndexPath`、`MEMORY.md` 内容与 `notes/` 内容完全相同；另一个 participant 在同一 `room-beta` 得到**不同**目录、看不到该标记；每个 RunAttempt 的物化收据 `schemaVersion=2`、`files.length=1`（index-only）且两次收据不同；无 coordinator 的回落路径落在同一目录。→ 覆盖 2.8 与 2.9 的物化面。
- `packages/daemon/test/real-role-contrast-gate.test.ts` 每个 Agent 使用独立 Room 并按 `roomId` 分别查询 `listActivations`/`listMessages`/`listRunAttempts`/`listTasks`，其“每 Room 独立、互不串线”的基础设施断言可复用为 2.6、2.10 的机器覆盖。
- 参与范围与成员投递本身没有专门的付费 gate；2.1—2.4 需要本协议实跑。

---

## 场景三：私聊延续

### 前置

- 承接场景二的同一实例与同一批身份。
- `exec-a` 在场景一/二中已经形成过至少一条私有记忆（`MEMORY.md` 或 `notes/` 下有内容）。若没有，先在 Room A 用一条明确要求保存的消息形成记忆，再进入本场景。

### 步骤

1. Human 打开与 `exec-a` 的私聊（UI：Agent 卡片上的私聊入口；API：`/rooms/direct/open`）。

2. 在私聊里发：

   ```
   这里是私聊。请只回答：你在此前的房间里为我建立了哪个文件、内容是什么？说明你从哪里读到的。
   ```

3. 再发一条要求写入新私有事实：

   ```
   请记住一条只属于你的信息：S3 私聊口令是 CANARY-S3-7741。存进你自己的记忆，然后确认已存。
   ```

4. 回到 Room A，发：

   ```
   @exec-a 请在这个房间说出 S3 私聊口令。
   ```

5. 在 Room A 再发一条给另一个 Agent：

   ```
   @audit-b 请说出 S3 私聊口令。如果你不知道，就明确说你不知道。
   ```

6. 静默后采集证据。

### 观察点与预期结果

| #    | 检查项                                     | 预期结果                                                                                                                              | 证据来源                                                                                       |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 3.1  | DM 用的是规范直连 Room，不是客户端自造会话 | `direct_room_pairs` 中存在一行，其 `left_principal_id` < `right_principal_id` 为 Human 与 `exec-a` 的 id，`room_id` 指向一个真实 Room | `direct_room_pairs`（表级 UNIQUE(`room_id`) 与 CHECK 保证左右序）                              |
| 3.2  | 开 DM 记在事件日志里                       | 存在一条 `type='workspace.direct_opened'` 的事件                                                                                      | `room_events.type`                                                                             |
| 3.3  | DM 唤醒理由正确                            | DM 内 Human 消息给 `exec-a` 的投递 `reason='dm'`（若实现按 Room 策略投递则为 `room_policy`，以实测为准并记录）                        | `inbox_items.reason`                                                                           |
| 3.4  | DM 回复落在 DM Room                        | 第 2、3 步的 Agent 答复 `messages.room_id` = `direct_room_pairs.room_id`                                                              | `messages.room_id`、`messages.actor_id`                                                        |
| 3.5  | DM 用的是同一记忆目录                      | 该 RunAttempt 的物化收据 `ownerParticipantId` = `exec-a`，目录仍是同一 `<sha256(participantId)>`                                      | `<memoryRoot>/.materialization-receipts/<sha256(runAttemptId)>.json`；文件系统路径             |
| 3.6  | 跨房间记忆在 DM 中可用                     | 第 2 步答复中的文件名/内容与 `MEMORY.md` 或 `notes/` 中记载一致                                                                       | 文件系统（记忆文件正文）+ `messages.body` 人工比对。**无账本列可证明模型读取**，此行为观察记录 |
| 3.7  | 新私有事实真的落盘                         | `CANARY-S3-7741` 出现在 `exec-a` 的 `MEMORY.md` 或 `notes/` 下某个文件中                                                              | 文件系统 `grep -r CANARY-S3-7741 <memoryRoot>/<sha256(exec-a)>/`                               |
| 3.8  | 回 Room 后能继续协作并召回                 | 第 4 步在 Room A 的答复正文包含 `CANARY-S3-7741`                                                                                      | `messages.body`（Room A）、`messages.actor_id`                                                 |
| 3.9  | 私有记忆不外泄                             | `CANARY-S3-7741` **不**出现在 `audit-b` 的记忆目录任何文件中；`audit-b` 第 5 步的答复不含该口令                                       | 文件系统 `grep -r CANARY-S3-7741 <memoryRoot>/<sha256(audit-b)>/` 必须无命中；`messages.body`  |
| 3.10 | 基础设施干净                               | DM 与 Room A 的所有 Activation 终态、`run_attempts.exit_code=0`                                                                       | `activations.state`；`run_attempts.exit_code`                                                  |

### 失败判据

- 不存在 `direct_room_pairs` 行，或 DM 消息的 `room_id` 不等于该行的 `room_id`（即 DM 走了客户端自造会话）。
- 第 3 步声称已保存，但 `grep` 在 `exec-a` 的记忆目录里找不到 `CANARY-S3-7741`（模型自述与文件系统冲突时，以文件系统为准，判失败并记录为模型拒写/未写）。
- **一个 Agent 拿到了另一个 Agent 的私有记忆**：`CANARY-S3-7741` 出现在 `audit-b` 的记忆目录中，或 `audit-b` 在从未被告知的情况下说出该口令。这是隔离缺陷，直接判失败。
- 3.6、3.8 中模型未召回，但文件确实存在且目录正确：记为“模型未召回”观察项，不判链路失败；文件不存在或目录不对，才判失败。

### 已有的自动覆盖

- `packages/daemon/test/agent-memory-runtime-continuity.test.ts` 的隔离段已机器验证 3.9 的结构面：另一个 participant 在同一 Room 得到不同的 `memoryDirectory`，其 `MEMORY.md` 不含对方标记，`notes/` 下对应笔记为 `null`。
- 隔离的强制点是路径派生而非授权检查：`agentMemoryWorkspacePath()` 只接受 `participantId`，调用方无法传入任意路径；`safePath()`（`packages/agent-host/src/agent-workspace-browser.ts`）拒绝绝对路径、`..`、反斜杠/NUL、符号链接、硬链接与特殊文件，越界时抛 `Workspace path escaped its owner`；`materializeAgentMemoryForRun()` 在物化时校验路径与 owner 一致，否则抛错。这些是已有的确定性覆盖，本场景只需验证端到端不破。
- DM 的规范配对、`workspace.direct_opened` 事件与跨 Room→DM 的记忆延续**没有付费 gate 覆盖**，3.1—3.4、3.6—3.8 必须实跑。

---

## 场景四：配置切换与恢复

### 前置

- 隔离实例（切换与断线部分）。若要验证正式实例的重启恢复，先按“执行须知”备份并确认空闲。
- Room A 中至少两个 Agent 同时有工作：`exec-a`（将被切换配置）与 `audit-b`（不动，用于验证互不影响）。
- 记录切换前的基线：`exec-a` 当前的 `agent_definitions.current_revision_id`、对应 `agent_definition_revisions.execution_policy_revision_id`，以及该 policy 的 `policy_json` 中 `$.modelIntent.exactBindingIds` 与 `$.modelIntent.reasoning`。

### 步骤

1. Human 在 Room A 发一条会让两个 Agent 都开始干活、且 `exec-a` 会持续一段时间的消息：

   ```
   @exec-a 请先创建 acceptance/S4-active.marker，然后执行 sleep 20，再把 acceptance/S4.txt 写成一行 S4 EXEC OK 并在房间报告 S4 BUSY DONE。
   @audit-b 请独立地把 acceptance/S4-audit.txt 写成一行 S4 AUDIT OK 并报告 S4 AUDIT DONE。
   ```

2. **确认忙时窗口。** 轮询直到两个条件同时成立：

   ```sql
   SELECT run_attempt_id FROM run_attempts
    WHERE participant_id='<exec-a>' AND state='running';
   ```

   非空，且工作区中 `acceptance/S4-active.marker` 存在。**不要用计时器代替这两个条件。**

3. 在该窗口内，Human 切换 `exec-a` 的 CLI / model / effort（UI：Agent 运行时对话框 `apps/web/src/components/agent-runtime-dialog.tsx`；API：`/agents/manage`）。切到授权矩阵中的另一组，例如从 OpenCode `deepseek/deepseek-v4-flash` low 切到 Codex `gpt-5.6-luna` low。

4. 立刻在 Room A 追加一条需要独立作答的消息：

   ```
   @exec-a 插一个独立问题：acceptance/S4.txt 现在存在吗？只回答存在或不存在。
   ```

5. **断线 / 服务重启。** 在 `exec-a` 的新一轮执行进行中，停止工作台进程（隔离实例：向 `run-local-workbench.mjs` 的 pid 发 SIGTERM；正式实例：走 `scripts/restart-local-workbench.mjs`，注意它在非空闲时会拒绝，这本身就是预期行为，此时改为在隔离实例上做本步）。随后用同一 `RAH_DATA_HOME` 重新启动。

6. 不重发任何 Human 请求，等待恢复完成并静默。

7. **验证底层 CLI 真的换了。** 在第 3 步之后的**新一轮**执行运行中（可用第 4 步或再补一条消息制造窗口），做进程侧取证：

   ```sh
   # 1) 找到活动 RunAttempt
   sqlite3 -readonly "$RAH_DATA_HOME/state/room.db" \
     "SELECT run_attempt_id, placement_id FROM run_attempts WHERE participant_id='<exec-a>' AND state='running';"
   # 2) 读出该 placement 冻结的模型
   sqlite3 -readonly "$RAH_DATA_HOME/state/room.db" \
     "SELECT json_extract(decision_json,'\$.resolvedModel') FROM placements WHERE placement_id='<上一步>';"
   # 3) 用进程环境把 pid 反向 join 回同一个 RunAttempt，并读出真实 argv
   ps -eo pid,command | grep -i '<provider 可执行文件名>'
   ps eww <supervisor-pid>    # 读 RAH_PROCESS_SUPERVISOR_CONFIG 中的 {command, args}
   ps eww <driver-pid>        # 读 RAH_RUN_ATTEMPT_ID / RAH_PARTICIPANT_ID
   ```

   各 CLI 的模型与 effort 出现在哪里（`packages/agent-host/src/runtime-implementation-registry.ts` 与各 driver）：

   | CLI      | adapter → driver 的参数                              | driver → 真实 provider 进程                                                                                                                                            |
   | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Claude   | `--model <modelId>` `--effort <reasoning>`           | 直接作为 provider argv 出现（`claude-stream-json-driver.mjs`），`ps` 可直接看到                                                                                        |
   | Codex    | `--model <modelId>` `--reasoning <reasoning>`        | provider 进程只显示 `codex app-server --listen stdio://`；模型走 JSON-RPC `threadStart.model` 与 `config.model_reasoning_effort`，**只能在 driver 进程的 argv 上看到** |
   | Kimi     | `--model <modelId>` `--thinking-level <reasoning>`   | provider 进程只显示 `kimi acp`；模型走 ACP `session/set_model`，thinking 级别未被确认时 driver **直接失败**（这本身是应用成功的证据）                                  |
   | OpenCode | `--model <provider/modelId>` `--variant <reasoning>` | provider 是 OpenCode server；模型走 HTTP session body 的 `model`/`variant`，**只能在 driver 进程的 argv 上看到**                                                       |

   仅当 `resolvedModel.source === 'explicit_binding'` 时才会下发模型参数；effort 仅当 `reasoning` 存在且不等于 `'default'` 时下发。若 `resolvedModel` 为 `{"source":"runtime_default","selection":"no_model_selector_sent"}`，说明**根本没有发送任何模型选择器**，此时“前端配置变了但底层没换”不是缺陷而是配置未落到 `modelIntent`——按 4.3 判定。

### 观察点与预期结果

| #    | 检查项                                | 预期结果                                                                                                                                                                                                                                                       | 证据来源                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1  | 配置写出了新版本，而不是就地改        | 切换后 `agent_definitions.current_revision_id` 指向一条**新的** `agent_definition_revisions` 行，其 `execution_policy_revision_id` 也是新行；旧行仍在表中未被修改                                                                                              | `agent_definitions.current_revision_id`；`agent_definition_revisions`；`execution_policy_revisions`                                                                                                                                                                                        |
| 4.2  | 新 policy 的意图正确                  | 新 `execution_policy_revisions.policy_json` 的 `$.modelIntent.exactBindingIds[0]` 与 `$.modelIntent.reasoning` 等于本次要切到的授权组合；`$.required.allowedOfferIds` 指向新 CLI 的 offer                                                                      | `execution_policy_revisions.policy_json`                                                                                                                                                                                                                                                   |
| 4.3  | **底层真的换了模型/effort（持久面）** | 切换后新产生的 `placements` 行，其 `decision_json` 的 `$.resolvedModel.source='explicit_binding'`、`$.resolvedModel.modelBindingId`/`$.resolvedModel.modelId`/`$.resolvedModel.reasoning` 等于新配置；`$.runtimeProfileRevisionId` 指向新 CLI 的 profile       | `placements.decision_json`（经 `run_attempts.placement_id` join）；`placements.runtime_profile_revision_id`                                                                                                                                                                                |
| 4.4  | **底层真的换了模型/effort（进程面）** | 第 7 步的 `ps` 显示：driver 进程 argv 含新的 `--model <modelId>` 与对应的 effort 参数（Claude `--effort` / Codex `--reasoning` / Kimi `--thinking-level` / OpenCode `--variant`）；该进程的 `RAH_RUN_ATTEMPT_ID` 等于 4.3 中那条 `run_attempts.run_attempt_id` | `ps -o command=` / `ps eww` 的 `RAH_PROCESS_SUPERVISOR_CONFIG` 与 `RAH_RUN_ATTEMPT_ID`。**argv 不写入任何数据库表、不写入 `runtime_processes.recovery_descriptor_json`、不写入 `run_trajectory_entries`、不写入 `~/.rah/logs/`；进程观察是唯一的实时证据，必须在运行中取，事后无法补取。** |
| 4.5  | 旧 Run 不被改写                       | 切换发生时正在跑的那条 `run_attempts` 及其 `placement`，`agent_definition_revision_id`/`execution_policy_revision_id`/`decision_json` 与切换前一致；`placements.state` 走到 `consumed`，`decision_json` 无变化（唯一后续更新只改 `state`/`release_reason`）    | `placements` 三列 + `decision_json` 逐字段比对                                                                                                                                                                                                                                             |
| 4.6  | 切换不打断在跑的进程                  | 切换动作没有让当时活动的 `run_attempts` 变成 `failed`/`cancelled`/`timed_out`；旧 Run 正常 `exited` 且 `exit_code=0`                                                                                                                                           | `run_attempts.state`/`exit_code`/`finished_at`                                                                                                                                                                                                                                             |
| 4.7  | 其他 Agent 完全不受影响               | `audit-b` 的 `run_attempts` 在整个切换窗口内 `exit_code=0`，其 `placements.agent_definition_revision_id` 未变，且 `acceptance/S4-audit.txt` 内容为 `S4 AUDIT OK`                                                                                               | `run_attempts`（`participant_id='<audit-b>'`）；`placements`；工作区文件                                                                                                                                                                                                                   |
| 4.8  | 未完成工作可恢复                      | 服务重启后，**未重发任何 Human 请求**的前提下，原 Activation 产生更高 `attempt_number` 的新 `run_attempts` 并完成；`activations.attempt_count` 增加，最终 `state='completed'`                                                                                  | `run_attempts.attempt_number`/`activation_id`/`exit_code`；`activations.attempt_count`/`state`                                                                                                                                                                                             |
| 4.9  | 崩溃留下的进程被正确收敛              | 断线后旧 `runtime_processes.state` 走到 `orphaned` 或 `terminated`；对应 `run_attempts.state` 为 `orphaned`，并有 `type='run.orphaned'` 事件                                                                                                                   | `runtime_processes.state`；`run_attempts.state`；`room_events.type`                                                                                                                                                                                                                        |
| 4.10 | 恢复不改模型                          | 若发生的是 reattach（`recovery_driver='rah-process-supervisor-v1'`，按 `recovery_descriptor_json` 的 `recoveryKey` + `metadata.controlToken` 重挂），恢复进程沿用原 argv，模型不变；若是新 attempt，则按当前配置解析新 `placements`                            | `runtime_processes.recovery_driver`/`recovery_descriptor_json`；新 `placements.decision_json.resolvedModel`                                                                                                                                                                                |
| 4.11 | 恢复只发一条结果                      | 恢复后 Room A 中该轮的业务结论只出现一次，不重复发布                                                                                                                                                                                                           | `messages.body`、`messages.created_at`、`messages.actor_id`                                                                                                                                                                                                                                |
| 4.12 | 忙时切换不吞掉原回复                  | 原轮次结论与追加问题答复都存在；若有暂缓，`held_message_drafts` 的最终 `resolution_kind` 不是 `revised`/`expired`                                                                                                                                              | `held_message_drafts.resolution_kind`/`body`；`messages.body`                                                                                                                                                                                                                              |

### 失败判据

- **配置只在前端变了**：`agent_definitions.current_revision_id` 已指向新版本，但切换后新产生的 `placements.decision_json.$.resolvedModel` 仍是旧 `modelId`/`reasoning`；或 `resolvedModel` 与第 7 步 `ps` 观察到的 driver argv 不一致。二者任一不符即判失败。
- 新 `placements.decision_json.$.resolvedModel.source` 为 `runtime_default` 而 UI 上确实选了具体模型——说明配置没有落到 `modelIntent`，判失败。
- 切换动作导致**任何**其他 Agent 的 `run_attempts` 进入 `failed`/`cancelled`/`timed_out`，或其 `placements` 的 revision id 发生变化。
- 切换导致当时正在跑的旧 Run 的 `placements.decision_json` 被改写（冻结被破坏）。
- 重启后原 Activation 停在 `quarantined` 且 `activation_retry_fences.state='blocked'` 而无人工介入无法前进；或需要 Human 重发原请求才能完成。
- 恢复后同一业务结论在 `messages` 中出现两次（重复发布）。
- 第 7 步在运行中未能取到进程证据（错过窗口）：本次 4.4 记为“未取证”，**不得**用 4.3 的账本值代替填写，须重跑该步。

### 已有的自动覆盖

- `packages/kernel/test/durable-placement.test.ts` 的 `"RunAttempt references frozen placement after Agent and Policy v2 activation"` 已机器验证 4.5：历史 Run 的 `placement.agentDefinitionRevisionId` 仍等于 v1、不等于 v2，且 `placement.state === 'consumed'`。同文件还覆盖过期租约不双跑、替代 Host 世代不能接管前代 Placement、终态 RunAttempt 才释放容量。
- `scripts/run-agent-runtime-continuity-browser-gate.mjs`（`npm run test:web:agent-runtime-continuity`，**Fake runtime 浏览器门禁，不花钱**）已机器验证：配置变更**不替换正在跑的进程**（`observations().length === 1`），第二个子进程的 argv 含新 profile 与 `high` 参数，且第一条观察记录事后逐字节不变。这是 4.4 唯一已有的 argv 级机器覆盖，但用的是 fake runtime——**它不证明真实 provider CLI 收到了新模型**，本场景第 7 步不能因它跳过。相关审计：`docs/audits/2026-09-07-runtime-configuration-continuity.zh-CN.md`。
- `packages/daemon/test/workbench-restart-guard.test.ts` 与 `restartable-local-workbench.test.ts` 已机器验证空闲门禁：`workbenchIsIdle()` 在 `activations`/`run_attempts`/`runtime_processes`/`placements`/`agent_exclusive_operation_leases` 五张表任一非空时返回 `busy`，重启被拒绝而不是强制执行。
- `packages/agent-host/test/process-recovery-integration.test.ts` 的 `"AgentHost recovers a prepared Generic runtime after crashing before run.started"` 已机器验证 4.10 的 reattach 路径。
- `packages/daemon/test/busy-hold-recovery-chain.test.ts` 覆盖 4.12 的机制面（见场景一）。
- `real-agent-split-chain-gate` / `real-busy-hold-gate` / `real-role-contrast-gate` 三个付费 gate 在开跑前都会核对 catalog 中确有该 `modelId` 且 `binding.supportedReasoning` 含授权 reasoning，并以 `modelIntent.exactBindingIds` + `fallback:"disabled"` 钉死花销——共同的注释是“a gate must never quietly spend on a different reasoning level than the one the user approved”。这覆盖了 4.2 的意图面，但**不覆盖运行中切换**。
- 4.1、4.3、4.4、4.7、4.8、4.11 的真实模型端到端**没有付费 gate**，必须实跑。

---

## 场景五：记忆正反对照

### 前置

- 可在隔离实例上用新身份跑完整对照；若要验证“更正旧事实后新会话正确召回”针对已积累记忆的真实身份，则用正式实例（先备份）。
- 两个 Agent：`mem-a`（形成记忆）与 `mem-b`（反向对照，不得获得 `mem-a` 的私有记忆）。两者绑定不同 CLI。
- 至少两个 Room（Room A、Room B）与一个 `mem-a` 的 DM。
- 记录两者的记忆目录路径：`<memoryRoot>/<sha256(participantId)>/`。

### 步骤

1. Room A 顶层：

   ```
   @mem-a 请记住一条只属于你的信息：S5 项目代号是 ORIOLE-1。存进你自己的记忆，然后确认已存。
   ```

2. 换到 Room B 顶层：

   ```
   @mem-a 请说出 S5 项目代号。
   ```

3. 在与 `mem-a` 的 DM 中：

   ```
   请说出 S5 项目代号。
   ```

4. **反向对照。** Room A 顶层：

   ```
   @mem-b 请说出 S5 项目代号。如果你不知道，就明确说你不知道，不要猜。
   ```

5. **更正旧事实。** Room A 顶层：

   ```
   @mem-a 更正：S5 项目代号从 ORIOLE-1 改为 ORIOLE-2。请更新你的记忆，让旧值不再被当作当前事实。
   ```

6. **新会话召回。** 结束当前所有执行，等待完全静默，然后在 Room B（一个新的 Activation、新的进程）发：

   ```
   @mem-a 请说出 S5 项目代号的当前值，并说明你从哪里读到的。
   ```

7. 若要跨 CLI 验证，把 `mem-a` 切到授权矩阵中的另一个 CLI（按场景四的方式与取证要求），重复第 6 步。

8. 静默后采集证据。

### 观察点与预期结果

| #    | 检查项                    | 预期结果                                                                                                                                                    | 证据来源                                                                                                                                                             |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | 记忆真的落盘              | `ORIOLE-1` 出现在 `<memoryRoot>/<sha256(mem-a)>/MEMORY.md` 或 `notes/` 下的文件中                                                                           | 文件系统 `grep -r ORIOLE-1 <memoryRoot>/<sha256(mem-a)>/`                                                                                                            |
| 5.2  | 目录归属正确              | 第 1 步 RunAttempt 的物化收据 `ownerParticipantId` = `mem-a`，`schemaVersion=2`                                                                             | `<memoryRoot>/.materialization-receipts/<sha256(runAttemptId)>.json`                                                                                                 |
| 5.3  | 跨 Room 记忆是同一份      | Room B 的 RunAttempt 收据指向同一 `<sha256(mem-a)>` 目录；目录未被重建                                                                                      | 收据文件 + 目录路径                                                                                                                                                  |
| 5.4  | 跨 Room 召回              | 第 2 步答复含 `ORIOLE-1`                                                                                                                                    | `messages.body`（Room B）、`messages.actor_id`                                                                                                                       |
| 5.5  | DM 召回                   | 第 3 步答复含 `ORIOLE-1`，且 `messages.room_id` = `direct_room_pairs.room_id`                                                                               | `messages.body`、`messages.room_id`；`direct_room_pairs`                                                                                                             |
| 5.6  | **反向对照：不外泄**      | `ORIOLE-1` **不**出现在 `<memoryRoot>/<sha256(mem-b)>/` 任何文件中；`mem-b` 第 4 步的答复不含 `ORIOLE-1`                                                    | 文件系统 `grep -r ORIOLE-1 <memoryRoot>/<sha256(mem-b)>/` 必须无命中；`messages.body`                                                                                |
| 5.7  | 两个 Agent 的目录确实不同 | `<sha256(mem-a)>` ≠ `<sha256(mem-b)>`，两个目录权限均为 0700，`MEMORY.md` 为 0600                                                                           | 文件系统 `ls -ld`、`stat`                                                                                                                                            |
| 5.8  | 更正落盘                  | `ORIOLE-2` 出现在 `mem-a` 的记忆文件中；旧值 `ORIOLE-1` 或被删除，或被明确标注为已废弃（人工判读文件正文）                                                  | 文件系统（记忆文件正文）                                                                                                                                             |
| 5.9  | 新会话召回更正后的值      | 第 6 步答复含 `ORIOLE-2` 且**不**把 `ORIOLE-1` 当作当前值；该次执行是新的 `run_attempts`（`run_attempt_id` 与第 5 步不同），并有独立的物化收据              | `messages.body`；`run_attempts.run_attempt_id`；收据文件                                                                                                             |
| 5.10 | 跨 CLI 仍召回             | 第 7 步切换 CLI 后答复仍含 `ORIOLE-2`；同时按 4.3/4.4 确认底层确实换了 CLI                                                                                  | `messages.body`；`placements.decision_json.$.resolvedModel`；`ps`                                                                                                    |
| 5.11 | 记忆归属 Computer 未冲突  | `agent_memory_homes` 中 `mem-a` 的行 `state='bound'` 且 `owner_host_id` 非空                                                                                | `agent_memory_homes.state`/`owner_host_id`                                                                                                                           |
| 5.12 | 没有“已读记忆”的账本证据  | `context_manifests.manifest_json` 中与记忆相关的只有 `agentDefinition.memoryPolicyRef`（策略引用），**不含记忆内容也不含读取记录**；`run_attempts` 无记忆列 | `context_manifests.manifest_json`；`run_attempts` 表结构。**本行是对协议本身的约束：任何“模型读了记忆”的结论只能来自文件内容与答复正文的比对，不得引用不存在的列。** |

### 失败判据

- **一个 Agent 拿到了另一个 Agent 的私有记忆**：5.6 中 `grep` 在 `mem-b` 的目录里命中 `ORIOLE-1`，或 `mem-b` 在从未被告知的情况下说出该值。直接判失败。
- 第 1 步或第 5 步模型声称已保存，但文件系统中找不到对应内容。以文件系统为准判失败，并记录为模型拒写/未写行为（已知的模型行为差异：曾观察到 OpenCode/DeepSeek 把明确要求保存的虚构资料误判为记忆投毒而拒写；同一身份切到 Kimi K3 后正常写入。这类现象记为模型行为差异，不等同于记忆存储链损坏，但**必须**据文件系统如实记录为该次未保存）。
- 第 6 步答复把 `ORIOLE-1` 当作当前值，而文件中已明确记为废弃——记为“更正未生效”，判失败。若文件中旧值仍与新值并列且无废弃标注，则失败归因为第 5 步未落盘（5.8），而非召回。
- `mem-a` 的记忆目录在跨 Room / 跨 CLI 后变成不同的 `<sha256>` 路径，或出现第二个目录。
- 记忆目录权限不是 0700 或 `MEMORY.md` 不是 0600。
- 判定“模型是否召回”时引用了 `context_manifests` 或 `run_attempts` 中并不存在的记忆列——协议执行本身失败，重做该行。

### 已有的自动覆盖

- `packages/daemon/test/agent-memory-runtime-continuity.test.ts` 已机器验证 5.2、5.3、5.6 的结构面、5.7 与 5.11 的路径面：同一 participant 跨 Room 跨 RuntimeProfile/模型得到相同 `memoryDirectory`/`memoryIndexPath`/`MEMORY.md` 内容/`notes/` 内容；另一个 participant 得到不同目录、看不到标记、对应笔记为 `null`；每个 RunAttempt 有独立的 `schemaVersion=2`、`files.length=1` 收据；无 coordinator 的回落路径落在同一目录。
- 隔离的三层强制点（路径派生 `agentMemoryWorkspacePath()`、`safePath()` 的越界/符号链接/硬链接拒绝、`materializeAgentMemoryForRun()` 的 owner 校验）都是已有的确定性覆盖。
- `docs/audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md` 记录了七次真实付费跑动（OpenCode/DeepSeek 与 Kimi）的形成、反向对照、新会话与跨 Provider 召回；`docs/audits/2026-09-08-frozen-core-four-class-acceptance.zh-CN.md` 记录了同一身份跨四种 CLI 读回更正后记忆。**这些是历史证据，不是当前构建的通过凭据**，本场景仍须实跑。
- 5.4、5.5、5.8、5.9、5.10 的真实模型行为**没有付费 gate**，必须实跑。

---

## 已知未对齐

本协议**预期会暴露**下列两项。它们是明知未实现的差异，不是本次跑动新发现的缺陷；测试者观察到下述现象时必须记为“已知未对齐”，不得记为新缺陷。

### 一、忙时投递：Raft 按 Runtime 分档 vs RAH 统一冻结 Activation + 持久后继

- **Raft 的行为**：按 Runtime 分档。Claude 走 gated 投递；Codex 与 Kimi 直接投递；OpenCode 不投递。也就是说同一个忙时窗口，不同 CLI 的 Agent 会看到不同的中途消息可见性。
- **RAH 的行为**：对所有 Runtime 一致。当前 Activation 的 `[from_seq, to_seq]` 冻结，忙时到达的新事件**不注入**正在跑的进程，而是生成新的 `inbox_items` 与一条新的 `activations`（其 `from_seq` = 新事件的 `room_seq`）；原 Run 若在冻结上界之外尝试发布，会被 hold 成 `held_message_drafts` 一行并收到 `SEND_HELD_AS_DRAFT`，后继 Run 以 `message-post --send-draft --target '#room'` 恢复。
- **观察时应当看到**：不论 `exec-a` 绑的是哪个 CLI，忙时追加消息都**不会**在当前 Run 中被看到；`activations` 出现第二行而不是第一行的 `to_seq` 被拉高；`held_message_drafts` 可能出现 `state='held'` 行。这些都是预期。
- **仍属真实缺陷的边界**：`held_message_drafts` 以 `resolution_kind='revised'` 或 `'expired'` 结束，而该草稿 `body` 中的实质结论在 `messages` 中找不到——即原回复丢失。这是 `docs/audits/2026-09-08-frozen-core-four-class-acceptance.zh-CN.md` 记录的核心阻塞（三次实验 F0908 / F0908H / F0908S 均复现），后续已由 `busy-hold-recovery-chain.test.ts` 与 `real-busy-hold-gate` 建立回归。若本次跑动再次出现该形态，按失败记录并引用该审计，不作为新问题重新描述。
- **不属缺陷的边界**：模型在含糊措辞下主动放弃原草稿。`real-busy-hold-gate` 的 `ambiguous` 变体正因为此才只观察不断言；本协议的场景一第 4 步与场景四第 4 步都使用了“插一个独立问题”的明确措辞，若测试者改写了措辞而看到草稿被替换，属于措辞影响，记录措辞原文，不记为链路缺陷。

### 二、执行模型：RAH 一次 Activation 一个进程 vs Raft 长驻会话 + 轮末收件箱

- **Raft 的行为**：一个长驻的 provider 会话，在每个 turn 结束时读一次收件箱。上下文在 turn 之间自然连续。
- **RAH 的行为**：每条 Activation 起一个新进程。`run_attempts` 与 Activation 一一对应（同一 Activation 重试时 `attempt_number` 递增）；进程退出即结束，provider 会话不跨 Activation 保活（Claude 路径会尝试 `--resume-session`，Codex/Kimi/OpenCode 的会话在切换 CLI 时必然丢失）。
- **观察时应当看到**：每一轮对话在 `run_attempts` 中都是新的一行、新的 `runtime_run_id`；`run_trajectory_entries` 按 `run_attempt_id` 分段，不存在跨轮连续的单一轨迹；Agent 对上一轮细节的“记得”只能来自记忆文件与 `sync` 呈现的 Room 上下文，不来自 provider 会话。同一句话在 Raft 上一次说完，在 RAH 上可能需要 Agent 重新读 Room 才能对齐——这是预期，不是漏回复。
- **不属缺陷的边界**：Agent 在新一轮里重新读取 Room 历史或重新读 `MEMORY.md`，多花了几步工具调用。`presented-context-second-activation.test.ts` 正是为收敛这类重复推导而存在：后继 Activation 的 sync 文本会明确写出 `Already presented: ...` 与已发布消息 id。若观察到 Agent 仍在重复推导，记录为观察项。
- **仍属真实缺陷的边界**：跨 Activation 丢失的是**已承诺的产出**（前一轮的原草稿、已认领的 Task 归属、已建立的 Thread 归属），而不只是上下文便利。

---

## 结果记录格式

一次跑动的结果写入 `docs/audits/<日期>-<主题>.zh-CN.md`，日期用跑动当天，主题短语用连字符（与既有文件一致，如 `2026-09-08-frozen-core-four-class-acceptance.zh-CN.md`）。

必须包含：

1. **跑动条件**：commit 与 tree、Web build id、实例是隔离还是正式（隔离给出 `RAH_DATA_HOME` 绝对路径；正式给出备份目录 `~/.rah/backups/pre-restart-<uuid>` 与其 `.receipt.json`）、每个 Agent 的 CLI / `modelBindingId` / reasoning、Owner 的开跑授权来源。
2. **五个场景各自 pass / fail**，逐场景一行结论。
3. **每个观察点逐行记录**，按本文的编号（1.1、1.2 …）。每行必须**引述实际证据行**：SQL 查询与其返回值、文件路径与 `grep` 结果、`ps` 输出的对应片段。**不得**写“已验证通过”“行为符合预期”一类概括句代替证据。未取到证据的行写“未取证”并说明原因，不留空、不用其他行的证据代填。
4. **失败项**：引用本文的失败判据原文，附最小复现条件（消息原文、时序、账本行）。
5. **已知未对齐的实际观察**：明确写出观察到的是上节的哪一条、表现如何，以及是否越过了该条列出的“仍属真实缺陷的边界”。
6. **本次未覆盖**：明确列出跳过的场景/步骤及跳过理由（通常是“已由某个确定性测试或付费 gate 机器覆盖”，须点名该测试文件）。
7. **花费**：实际调用的付费 CLI 与大致时长。

不写入的内容：模型的内部推理、凭据、token、控制令牌（`recovery_descriptor_json.metadata.controlToken` 与 `~/.rah/state/*.token` 不得出现在文档中）。
