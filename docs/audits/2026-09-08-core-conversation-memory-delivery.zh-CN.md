# 核心交付基线：聊天室、私聊、Agent 配置与记忆

2026-09-08。用户已将其他六组后端差异交给其他 Agent；本工作线改以四项核心体验及可靠性为交付目标。
本批为代码核验和隔离回归，没有修改产品代码、正式 Agent 配置或记忆，没有重启正在使用的服务。
共享工作树仍有并行施工，以下不是冻结发布或全产品 Raft 对等认证。

## 交付判断

核心基础已存在，不能重新列为待建设；但目前证据不足以宣称四项已全面高可用、与 Raft 完全一致。
交付必须从 Human 的实际旅程验收：在频道讨论、转入同一 Agent 私聊、切换运行配置、重新启动后继续，
消息留在正确目标，身份和私有记忆连续，失败能够恢复。接口数量和截图相似都不能替代这条链。

| 核心            | 已核实代码与本轮证据                                                                                                                                        | 仍需关闭的验收边界                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 聊天室及 Thread | Room ledger、持久唤醒、忙时 follow-up、Thread 关注归属已有；当前专项回归通过。Chrome/Firefox 的实际 Worker 子进程→显式消息/回应→桌面与移动页面投影通过      | 多 Agent 同时忙碌、多 Thread 连续追加、断线重连和迟到回复，必须用同一冻结候选做整条旅程；本轮浏览器工具门禁不覆盖所有发送/滚动/焦点行为                  |
| 私聊            | Direct Room 按双方稳定身份 open-or-create；重复打开复用原 Room，成员不可随意改变；发消息自动唤醒对方，当前单测通过                                          | 频道→私聊→频道的真实页面发送、历史定位和重启恢复仍需联合验收；不能以 Kernel 成功代替浏览器旅程                                                           |
| Agent 配置      | 原有配置回执恢复、不可变 Run 配置和下一 Run 应用已有；本轮真实浏览器切换 runtime/model/effort 后，旧子进程继续，新子进程收到新配置，身份与记忆目录不变      | 四 Provider 实际参数生效、busy/offline/失败恢复与当前冻结 UI 同条件对照仍应分别签收；本轮无付费模型调用                                                  |
| 记忆            | Raft 1.0.18 两个原始 prompt builder 有 hash 校验；启动完整原索引、正文按需、Agent 独立目录、切 Room/runtime 保留、不同 Agent 不自动注入对方文件均有当前测试 | 当前真实模型主动形成/新会话召回/更正旧事实/跨 Provider 召回未复验；同 UID 全文件访问不是操作系统级强隔离；压缩后重读仍是提示词要求，不能承诺模型一定执行 |

## 记忆策略的明确边界

`packages/agent-host/src/raft-memory/provenance.json` 固定 Raft Computer 1.0.18 源切片 SHA-256
`b47ccf545645f927d543aa377d50434b6d0982896c28d7794f1f90b801e97f83`。
`agent-memory-prompt.ts` 保留原记忆/压缩规则，单独说明 Agent 私有目录与运行 cwd、权限及传输适配。
本轮原文、无自定义筛选规则、完整索引、index-only 物化等测试通过。

当前 `packages/daemon/src/daemon-application-support.ts` 的 memory coordinator 仍为 `wake: () => false`：
整理提醒交给下一次 canonical Activation，不会独立唤醒空闲 Agent。
这与[已批准的策略收缩](./2026-08-30-memory-policy-retraction-audit.zh-CN.md)一致，不能偷偷恢复自动维护，
也不能把本地行为宣传成完整 Raft cleaner 生命周期。它是明确的策略差异，不是本轮新发现的故障。

## 本轮实际验证

证据根：`/Users/sun/Code/reviews/rah_os/2026-09-08-core-conversation-memory/`。

- `core-regression.log`：93 项通过，涵盖 memory、Direct Room、配置命令、冻结 Placement 与真实子进程连续性。
- `conversation-regression.log`：17 项通过，涵盖 Thread 归属、关注、暂存草稿及协作责任；其中部分为既有 Task 责任回归，不当作新增聊天能力计数。
- `recovery-regression.log`：14 项通过，涵盖忙时追加、租约恢复、隔离与 Outbox 等选定不变量。短期确定性测试不等于长期运行可用率。
- `runtime-browser.log`：Chrome 配置→实际子进程门禁通过，旧 Run 保持、新 Run 生效，测试 marker 跨运行保留；已检查截图。marker 由测试写入，不是模型记忆质量证明。
- `message-browser.log`：Chrome/Firefox 1440×900 与390×844，隔离真实 daemon/Worker 子进程的消息工具投影通过；已检查移动端截图。运行器为明确 Fake CLI。
- `configure-browser.log`：四组配置重试行为执行后，末尾来源冻结校验拒绝通过：其他施工修改了 `scripts/run-backend-gap-browser-gate.mjs`。这是并行工作树变化，不能记作配置产品缺陷，也不计入本轮通过门禁。保留失败日志，冻结候选后重跑。

浏览器临时证据：`rah-runtime-continuity-MTQV8r`、`rah-worker-tools-browser-J4KhlD`（根目录路径见日志）；
已复制审看的截图到本证据根。没有本轮官网同条件实操、付费模型、正式部署或全仓发布结论。

## 接下来的串行出口

1. **先封闭一条核心旅程**：专用隔离 Workspace 中，同一 Agent 从 Channel→Thread→DM→返回 Channel，验证发送对象、回复归属、重复打开、草稿、刷新、历史定位；与现有 Raft 证据逐行对照。不重新建设已经成立的 owner。
2. **在同一旅程加故障**：忙时追加、多 Thread、重复提交、HTTP 响应丢失、断线、daemon 重启。只认最终 canonical 消息和执行记录；不靠 CLI exit 或 UI 在线标识推断已完成。
3. **在同一身份切配置**：保存/不确定重试、旧 Run 冻结、下一 Run 新配置、停启/reset 的不同破坏范围；确保角色、记忆归属不变。真实 Provider 验收单独记录实际模型和 effort。
4. **证明记忆真正可用**：形成→新 Provider 会话召回→跨 Room/DM→更正→再召回；加入拿走文件、另一 Agent 的负向对照，排除旧会话缓存。未获本批付费执行授权前不启动模型测试。
5. **冻结候选后联合签收**：待其他施工批次交接，固定代码与构建，重跑受影响门禁，再协调唯一正式服务重启、数据保全和新页面验收。任何一项失败留在该环节，不用扩大清单掩盖未收口。

Raft 比较优先复用已授权来源：[配置合同](../design/agent-configuration-command.md)、
[Thread 合同](../product/2026-09-02-thread-column-parity-contract.zh-CN.md)、
[记忆基线](../product/agent-memory-raft-baseline.zh-CN.md)。只有缺少行为依据或需要证明当前官方效果时补官网实验。
