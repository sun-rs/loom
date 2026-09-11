# Codex 原始会话跨 Room/DM 寻址复验

## 判定

四步最终回复均在正确目标、仅一条、无 Thread 串入，原会话未改变。原来「Room A 的 S4 AUDIT DONE 发到 Room B」这次未重现。但 DM 首次产生两个无效目标请求，均 404，第二个 Run 才完成；因此业务落点通过，首次寻址与交互成本没有收口。不要把自动门禁 exit 0 等同于完整 Raft 对齐。

## 条件及原始性

保留事故原临时工作区 `rah-core-chain-m5HBvq`，启动前备份并验证 SQLite、文件和 Provider continuity 记录。原 Agent `steady-c` 的角色、execution policy、memory 和原 Provider session 都保留，未 reset、未换模型。当时仅缩小了 Host 配置名单，未缩小已有凭据。2026-09-11 后续复核发现，V4 配置名单是凭据子集校验，并不限制凭据已有的参与者执行权限；本轮实际上也执行了其他 Agent 的积压工作。因此不能将其称为纯 Codex 隔离实验，耗时包含共享执行通道上的等待。Agent 配置与成员 ACL 未改。纠正与真正窄凭据复验见 [语义寻址修复](./2026-09-11-worker-semantic-addressing-repair.zh-CN.md)。

Provider session：`01a08deb-67d7-7910-9855-eebfb9a622ae`。同一原始 Codex JSONL 中，能同时定位此前向 `#core-chain-room-b` 发 `S4 AUDIT DONE` 的事故工具调用，以及本次新增的五个 turn_context。这比只比较当前 session store 更强：不是拿一份新建会话充当旧会话。

真实 catalog、冻结 policy、driver argv 与原生 turn_context 均为 `gpt-5.6-luna` / `low`。全程同一 Provider session，四个阶段共五个 Run；DM 使用两个 Run，不能隐去第一次无结果退出。

## 四步结果

耗时为 Human 消息 created_at → 对应 Agent canonical 消息 created_at，不含尾部退出等待。

| 阶段          | 指令与实际结果                                                                          | 回复耗时 |
| ------------- | --------------------------------------------------------------------------------------- | -------: |
| Room B        | 新标记回复；实际调用 `#core-chain-room-b`，落到 B                                       |  25.0 秒 |
| Room A 原审计 | 沿用 CCG-9 的 Codex 审计部分及文件路径；实际调用 `#agent-council`，S4 AUDIT DONE 落到 A |  53.5 秒 |
| DM            | 最终调用 `dm:@owner`，落到该 Agent 与 Human 的 DM；此前两次 404                         | 137.0 秒 |
| 返回 Room A   | 新标记回复；落到 A                                                                      |  45.2 秒 |

A 步骤的 S4-audit.txt 原本可能已经正确，因此文件最终内容不单独证明本轮执行。本次原生工具轨迹确实有 apply_patch 和后续文件单行内容校验，作为本轮执行证据。首次补丁只替换相同文本，未将该文件断言冒充新的修复成果。

## DM 的真实问题与来源边界

sync 已呈现 `target=room_3176…` 与 `@principal_d86e…`。模型第一次自行改为 `--target dm-room_3176…`，404；又把 Human Principal ID 当 handle，调用 `room-resolve --target dm:@principal_d86e…`，再次 404。第一 Run exit 0，但没有业务回复，也没有完成交付；第二 Run 重新 sync、查帮助、按真正 Room ID resolve 后得到 `dm:@owner`，经正常 hold/send-draft 最终发出。

Raft Computer 1.0.18 `main.js` SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`：675916–675935 的 `formatTarget` / `formatSenderHandle` 明确给出 `#channel` / `dm:@handle` / 带 Thread 后缀的地址及真实发送者 handle；675944–675965 每条消息使用这些字段。

上一批修复让 RAH 的 target 技术上可直接执行，但仍以 Room UUID 与 Principal ID 呈现，与上述 Raft 显式语义地址还有差异。观察证明模型确实把 ID 拼错；它为何没有直接采用已经存在的合法 Room ID，不能仅凭一个样本归为唯一根因。接下来应补齐 Raft 的语义地址和发送者 handle 投影，保留 canonical ID、原解析器、ACL 与新鲜度围栏；不要接受臆造的 `dm-room_…` 或 `dm:@principal_…` 别名来掩盖问题，不追加自研记忆/角色规则。

## 验证器审查与补强

原运行的每步检查跨全库查询此 Agent 的新增消息，因此能抓错 Room，而不是只查预期 Room。结束后的 20 秒静默原本只检查 busy=false；独立审计指出这会漏掉期间已经完成的额外回复。主线程在真实运行结束后独立读取全库，再次确认从第一请求之后恰好四条 Agent 消息、逐条对应目标/正文/Thread，session 仍未变化。该独立尾部复核纳入证据。

门禁源代码已补齐尾部全库核对和 session 复查，并增加拒绝延迟错发、重复和错误 Thread 的默认测试；没有为此再跑付费模型。需明确：真实付费执行的是补强之前的门禁，新增尾部判据由保留账本独立复核完成，不把新版脚本标为已经付费重跑。

## 证据及剩余

- `/Users/sun/Code/reviews/rah_os/2026-09-11-target-presentation/codex-continuity-result.json`：四步请求/回复/Run、原生 model/effort 与 turn ID、白名单工具调用、事故同会话证据、最终全库复核。
- 同目录 `codex-continuity-gate.log`：付费门禁运行日志。
- 同目录 `pre-codex-continuity-1789094328328`：本次验证前的隔离状态备份。

正式 4173 未被本次验收修改或重启；本轮只增加测试和证据，不是产品修复批次。测试沿用原隔离状态并保留新消息，其他 Agent 的派生待处理工作不属于此次执行范围，后续复用该隔离状态须先检查，不能无预检启动全部付费 Runtime。

本轮是顺序跨 Room/DM 回归，未加入其他 Agent 并发配置切换、运行中断线/重启，也没有同条件 Raft 新样本。目标呈现这一项仍需处理 DM 语义地址差距并复验，之后才进入原生忙时投递。

检查收尾：完整 `npm run check`、`npm run format:check`、`git diff --check` 均通过。独立比对备份与结束后的全部 Agent revision ID 未改变；原生 session_meta ID 与事故会话一致。DM 两次 Run 属于同一 Activation，第一次 02:41:40.982Z 结束，第二次 02:42:11.003Z 开始，相隔约 30 秒。这是此次无效寻址后的恢复等待，不应混同于之前 Kimi 忙时投递的 132 秒等待。
