# 冻结构建：四类核心验证与忙时回复阻塞

日期：2026-09-08。结论：已完成本轮有界矩阵的验证执行；**不能全部签收**。真实 CLI、记忆连续性、三轮协作、Thread 实时更新与一次执行中恢复通过；忙时原回复被 freshness hold 后没有可靠延续，三次本地实验失败，Raft 实景对照存在明确差异。不能以基础门禁通过宣称完整高可用或完整复刻。

## 冻结与证据边界

- 用户明确要求冻结并提交。产品 commit：`09a244cfbc9940f6c6ea587158ef24dfbb8b5ed9`；tree：`b2c2f5a27c9159f1da20a8e3e7830cb10d415119`；冻结时工作树干净，未 push。
- Web build：`485485c36beffdc58ad0020b3924840bfc314c2ae072a48e54acdae9c6e9ff6d`。从正式冻结资产复制，验证中没有重建、替换产品代码或更改产品默认行为。
- 独立 detached checkout：`/Users/sun/Code/reviews/rah_os/2026-09-08-frozen-core-acceptance/checkout`。独立 npm 安装；真实四 CLI 门禁留下的同一数据库、工作区、Agent 身份继续用于后续旅程。
- 证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-frozen-core-acceptance/`。`freeze.json`、`build.json`、`plan.md` 固定条件；原始状态与诊断留在本机，文档不发布凭据或模型内部推理。
- 本轮是验证批，不是新修复批；正式服务未因故障实验重启。隔离实例单独停止、重启和备份；结束后关闭隔离页面，重新打开正式 `http://127.0.0.1:4173/` 并实际读取原 Room 历史。

冻结前执行 `npm run check`、`npm run format:check`、`git diff --cached --check`、`npm run build:web:workbench`，均通过。授权原始 bundle 保留字节内容，以已有冻结证据策略配置其 whitespace 属性，不改写上游内容。验证后只增加本审计文档与索引，不改变冻结产品。

## 四类矩阵

| 类别               | 实际执行与结果                                                                                                                                                                                                                                                                                                  | 不应扩大为的结论                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 真实 CLI 与配置 | Claude Sonnet 4.6 low、Codex gpt-5.6-sol low、Kimi K3 low、OpenCode DeepSeek V4 Flash low 均实际回复；四 CLI Task gate 通过，只有一个 Task owner 并产生真实交付文件。同一 B 身份跨四种 CLI 能读回更正后的记忆。忙时 OpenCode→Codex 的旧/新 Run 各自使用正确模型，但原回复丢失，见下文。                         | 不是每种 CLI 的所有 effort/模型、每种忙时切换组合都通过；没有以 Agent 自述证明模型参数。                                                       |
| 2. 记忆正反对照    | B 私聊保存新虚构事实，检查实际 `MEMORY.md/notes`；A 私聊不知道答案。B 清空 provider 会话后在只加入 B 的 Room 召回；更正后服务重启、再次重置会话，回 DM 正确回答新值并标旧值无效。A 重启后仍不知道。身份、配置和成员关系延续。                                                                                   | 不代表同一 OS 用户下的恶意 CLI 文件沙箱隔离，也不证明模型永不误写事实。                                                                        |
| 3. 同一冻结旅程    | 同一数据库完成 Room A 临时执行/审计三轮、六条独立发言、目标停止；同时两条 Thread 各回复一次且不串线。打开的 Thread Y 从一条回复自动更新到两条，未发送草稿保留。执行中停止服务，原 Activation 自动 attempt 2 成功，只发一条恢复结果，旧退出记录不变，另一 Agent 恢复后响应。页面自动重连，新页面读取到恢复结果。 | 算术三轮不是复杂项目审计保证；只故障注入了一个真实 Codex 执行场景，不是全部 CLI/OS 故障时序穷举。                                              |
| 4. Raft 双边       | 官网专用 Agent/频道/DM 完成相同虚构记忆形成、负向对照、跨 Room、更正、会话重置后召回；三轮六条协作及停止；Thread X/Y 各自正确回复，Y 打开期间从 8 到 9 条，原草稿保留。另用同一 DeepSeek 模型复现 freshness hold 并成功恢复原草稿，与 RAH 对照。                                                                | 不是相同 viewport 的全产品像素验收；未中断整个官方 Computer；官方 Kimi/DeepSeek UI 未暴露同样的 low 选项，记录为默认，不假称 effort 完全一致。 |

配置门禁 `npm run test:web:agent-runtime-continuity` 另通过 `oldRunFrozen/nextRunConfigured`，这是 **Fake runtime 浏览器门禁**；真实模型与实际回复证据来自独立 paid gates，不混淆等级。

## 已确认的核心阻塞：忙时原回复没有可靠恢复

### 三次 RAH 实验

1. F0908：B 在 OpenCode/DeepSeek low 执行 `sleep 12`。运行中配置改为 Codex/Sol low，追加另一条需独立回答的 Human 消息。旧 Run 仍用 DeepSeek，新 Run 用 Codex；只有 `F0908 FOLLOWUP DONE` 发布。
2. F0908H：保持 OpenCode/DeepSeek，不切 CLI，仍只有 `F0908H FOLLOWUP DONE`。排除“仅切换 provider 导致”的解释。
3. F0908S：真实 CLI 创建标记并进入 `sleep 20` 后，验收脚本才发送追加请求；仍只有 `F0908S FOLLOWUP DONE`。原回复遗漏不是单纯测试等候不足：执行已退出，Activation 队列已清空。

F0908 原 Run `run_896393bc-2b0e-440f-878c-5c3f7871fe52` 的可见工具记录显示：

- 已实际执行 sleep，并调用 `worker message-post` 发送原回复。
- 原回复被新 Human 消息触发 hold，生成 `held_draft_6f6394ca-35f9-466d-a409-39c5a292ee1b`。
- 尝试使用新 seq 提交，得到 `409: basedOnRoomSeq was neither delivered nor produced for this worker credential`；再次 sync 仍受当前 Activation 的冻结上界约束。
- 原 Run ACK 后正常退出。后继 Run 回复追加消息，旧草稿同时变为 `replaced/resolution_kind=revised`，原正文没有发布。

源码依据：`packages/kernel/src/held-message-drafts.ts` 的 `resolveHeldMessageDrafts` 按 Room + participant + Thread 批量替换所有 held 草稿；`collaboration-service.ts` 的 Agent message commit 调用该函数。当前 Worker sync/context 没有提供对应的完整跨 Run 草稿接续闭环。**“后继消息成功发布”不能证明“原暂缓意图已经被修订并满足”。**

这不是模型只把最终答案写到诊断的问题：原模型确实尝试走正式 Worker 发帖，受到 hold 与已投递范围约束；也不是 UI 漏渲染，canonical 原消息根本不存在。

### Raft 同模型与精确时序对照

Raft 专用 B 从 Kimi 切到 OpenCode，选择 DeepSeek V4 Flash。官网 native OpenCode 消息元数据实际为 `providerID=deepseek/modelID=deepseek-v4-flash`，variant 未提供；RAH 为 low，因此不声称完全同 effort。

- F0908H 相同两条提示，官网保留两条应答。
- F0908S 第一条已完成才来得及观察，**不计入忙时验收**。
- F0908S2 改用 60 秒观察窗口。实际标记时间 14:52:26 UTC，观察到标记后才通过浏览器发送追加消息，早于等待结束。官网工具在 14:53:27 首次发送原回复时真实返回 **Freshness hold**；14:53:32 `message send --send-draft` 成功；14:53:35 追加消息回复成功。页面实际看到两条结果。

官方原消息 ID：`c6b21587-bafe-4f6a-82a3-b8a92d97822f`；追加回复 ID：`55314c5a-16eb-422b-9aee-4c28ae6f6756`。证据见 `raft-timed-visible-tools.json`、`raft-busy-timed-marker.json`、`raft-busy-native-model.json`。

上游参考：授权 `raft-computer@1.0.18` 提取源 `packages/shared/src/agentApiContract.ts` 的 sendDraft 合同；`packages/daemon/dist/dist-UT7IQEHX.js` 的 `formatFreshnessHoldOutput`、`message send`；该提示明确提供 review bounded context 后发送原草稿的操作路径。来源根为 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`。本轮没有复制或修改上游代码，也不因差异删除 RAH 的因果屏障。发布来源为 `https://www.npmjs.com/package/raft-computer/v/1.0.18`；API 合同切片 SHA-256 为 `ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`，daemon 切片 SHA-256 为 `21b1bb9e6ed5ec2c7d5303a09e81e9b8bcf67c81c46b1994ec803c13382a42c1`。

### 下一批唯一优先闭环

由现有 Kernel 的 held draft/消息 owner 负责，先建立失败回归，再补齐“可验证地读取新事实 → 显式恢复、修订或放弃原草稿”。若 RAH 继续使用冻结 Activation 上界，后继 Run 必须得到原草稿及原目标的可靠交接；不能靠更多提示词或同目标任意发帖自动认定全部原草稿已解决。跨 CLI 丢失 provider 会话时也必须成立。

验收必须覆盖有/无 CLI 切换、同/不同 Thread、新事实要求真正改写、重复提交、原草稿仅允许精确解决及重启后接续，并复跑本次真实双边场景。本轮维持冻结候选，不把未实施方案标为修复完成。

## 记忆异常的独立归类

最初 OpenCode/DeepSeek 将 Human 明确要求保存的虚构 F0908 资料误判为记忆投毒，拒绝写文件。原回复引用了 `F0908 STORED` 字样，一版验收脚本用 substring 判断，险些误判成功。已改为实际文件断言，保存失败证据，且不把“另一 Agent 不知道尚未保存的事实”计作有效隔离验证。

同一 RAH Agent 切 Kimi K3 后，相同原提示真实写入 notes 与索引；Raft Kimi 同样写入 MEMORY.md。之后全部四种本地 CLI 都从该身份的私有文件召回更正值。当前归类为已观察到的模型拒写行为差异，尚无证据认定记忆存储链损坏；不声称任意模型都必然服从记忆维护请求。

## 执行中恢复证据

原 Activation：`activation_c4a67b5d-5bbc-45ad-bf51-5753624ae451`。真实 CLI 创建一次性标记并执行长等待；向隔离 daemon 发送 SIGTERM，产品 drain 超时后旧 Run 为 cancelled，error 为 `daemon drain timed out after 30000ms`。本次记录 exitCode=0、exitSignal=null，不虚构为 SIGKILL。

完全退出后，用原 frozen checkout、资产与数据库重新启动。未重新发送 Human 请求，attempt 2 `run_c0caa5c0-a325-44cc-be4b-6d4fff2c4f24` 自动完成；只有一条 `F0908R RECOVERED`。逐字段校验旧 Run 记录不变。随后 A 私聊回复 `F0908R-PEER ALIVE`。浏览器原 Thread 页面经历 Failed to fetch 后自动恢复，草稿保持；新 DM 页面实际显示恢复消息。

## 可复核证据与收尾

关键文件：

- `four-cli.log`、`runtime-browser.log`、`process-model-observations.json`、`native-model-evidence.json`、`switch-*-reply.json`、`switch-*-runs.json`。
- `memory-kimi-control-files.json`、`memory-valid-negative-before.json`、`memory-negative-after-restart.json`、`memory-corrected-after-restart.json`、`raft-memory-file-evidence.json`。
- `continuous-canonical-assertions.json`、`thread-X-result.json`、`thread-Y-result.json`、`active-recovery.json`、`recovery-peer.json`。
- `busy-switch-failure.json`、`busy-native-visible-actions.json`、`busy-no-switch-control.json`、`busy-timed-result.json`、`raft-timed-visible-tools.json`。
- `final-canonical.json`、重启前与最终状态备份、对应备份校验回执。

另一处外部验收脚本计数纠正：原 loop observer 把同 Room 的两条独立 Thread 回复一起计数。保留原记录，另以相同消息 ID 的 F0908L 六条、作者交替顺序、每轮算术及 COMPLETE 做只读断言；未重发启动指令，也未减少业务要求。

隔离实例在队列、Run、placement 与进程都空闲后完成最终备份并优雅停止；正式实例继续提供冻结构建。此次报告不覆盖其他批次的 HTML 附件定位、运行器用量或全产品视觉清单，也不恢复多 Human、远程 Computer、托管 MCP 等已排除范围。
