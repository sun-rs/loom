# Worker 语义寻址与真实 handle 修复

## 结论

读取输出的已确认差距已修复，并完成原 Codex Provider session 的 B → A 原审计 → DM → A 复验。最终窄 Host 凭据运行中，四步各一个 Run、各一条正确目标消息，DM 首轮成功，未出现寻址 404；同一原生会话的四条 turn_context 均为 `gpt-5.6-luna / low`。不把一次或两次未重现解释为原串线唯一根因已被证明。

## 已证实的缺陷及 Raft 依据

上一批确实修复了消息缺少所属 Room，以及 `RoomID:ThreadID` 不可执行的呈现问题。但 DM 原失败轨迹还显示：sync 给出合法 Room UUID，却将 Human Principal UUID 渲染为 `@principal_…`；模型先构造 `dm-room_…`，再将该 Principal ID 当 handle 构造 `dm:@principal_…`，均 404。第一 Run 无业务回复退出，同一 Activation 再执行才成功。RAH 寻址器本身已支持 `#channel`、`dm:@handle`，缺口是没有将现有真实身份投影到读取输出。

上游参考为提取的 Raft Computer 1.0.18，`main.js` SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。`formatTarget` / `formatSenderHandle` 在 675916–675935 行明确生成 `#channel`、`dm:@peer` 和真实发送者 handle；675944–675965 的消息行使用它们。搜索名称呈现另见 676045 起的 `renderSearchSource`。源文件位于本机 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，原包及版权归上游；本批依用户授权做行为/结构移植，没有将完整 bundle 纳入生产依赖。

## 实现与所有权

- Protocol：可选 `addressing` sidecar 保存 Room→可执行地址、Principal→真实 handle；原有 canonical ID 不变。
- Kernel：`worker-addressing.ts` 复用现有 Room/Membership/Direct pair/Principal 与目标解析器。DM 对端由参与者视角决定；同名 slug 无法唯一解析时保留合法 UUID，绝不任意选择另一个 Room。不创建 DM、不放宽可见范围。
- AgentHost：sync、room-read、message-read、message-resolve、message-search 消费同一投影；消息发送者及 sync 提及显示真实 handle。搜索额外明确标记可执行 target，属于 RAH 接线，不冒称上游逐字输出。
- Thread 沿现有 `--target #channel --thread-id ThreadID` 合同呈现，与 Raft 的复合目标做结构适配。ACK、Task 状态、Activation、内存和 standing prompt 均不改变。
- 有界同步为新增投影逐事件保守预留字节；完整事件超预算留到下一页，cursor 不跳过未交付事件。没有扩大响应上限。

## 验证

首先添加真实 Worker HTTP→CLI 渲染测试，观察到旧输出为 Room UUID 和 `@principal_…` 而失败，再实施修复。默认测试覆盖频道、DM 三个读取面、搜索、真实 handle、两种错误 DM 地址继续 404、直接使用显示出的地址发送到正确 DM、两个 Thread 的真实发送落点，以及响应预算的完整事件续页。原有 fixture 文案随语义地址更新，业务状态/权限断言不削弱。

保留事故 Provider session `01a08deb-67d7-7910-9855-eebfb9a622ae`、同一 Agent `steady-c`、同一工作区和配置。未 reset、未改角色或私有记忆策略。最终运行前完整备份隔离状态；结束后跨全库检查此 Agent 的新增消息，并等待 20 秒再核对，没有只查预期 Room 来漏掉错发。

最终窄凭据结果，计时均为 Human canonical 消息 created_at → Agent canonical 消息 created_at：

| 步骤              | 回复耗时 | Run 数 | 落点    |
| ----------------- | -------: | -----: | ------- |
| Room B            |  23.0 秒 |      1 | B       |
| Room A 原审计指令 |  33.4 秒 |      1 | A       |
| DM                |  24.2 秒 |      1 | 正确 DM |
| 返回 Room A       |  28.0 秒 |      1 | A       |

DM 实际收到 `[target=dm:@owner ...] @owner: …`，随后直接使用 `--target "dm:@owner"`。正常的新鲜度 hold/send-draft 仍存在，它和错误地址 404 是不同事件；没有通过取消围栏让测试通过。

## 验收脚本隔离纠正

本批第一次语义修复复验也四步正确、DM 首轮成功约 39.1 秒。但进一步读全库发现，之前脚本仅修改 V4 `host.participantIds`，已有 Host 凭据仍授权其他 Agent，期间其他 Agent 执行了积压工作。V4 配置名单只是凭据子集校验，不是调度过滤器。旧轮也有此问题，已更正旧报告与证据，不能声称这些轮次只执行 Codex。

最终脚本改为单独签发仅含 `steady-c` 的 Host 凭据，仍保留原 hostId 和 Provider session，启动后断言实际授权名单，结束后断言全库没有其他参与者的新 Run。窄凭据复验通过，四条实际 Run 全部属于 Codex。秘密文件以 0600 写入隔离状态，结束后移除，不写进报告。

## 证据与适用边界

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-11-target-presentation/`。

- `semantic-continuity-narrow-result.json` / `semantic-continuity-narrow-gate.log`：最终窄凭据结果、真实工具调用、原生 model/effort、消息行、全体 Run、源码摘要。
- `semantic-continuity-first-result.json` / `semantic-continuity-first-gate.log`：首次结果与未隔离的限制，不隐藏。
- `codex-continuity-result.json`：原 DM 两次 404 的前一轮结果，追加了 Host 隔离纠正。

本轮没有重新执行 Raft 官网同条件实验，结论是源码对照实施 + 本地真实旧会话回归。旧会话已看过失败并成功恢复的经验，不能据耗时差额证明全部收益都来自修复；最终窄凭据又消除了其他 Agent 等待因素。原生忙时投递、真正并行的多 Agent 双边组合仍待后续串行收口。

发送/Task hold 的非空 newerMessages 窗口仍有旧的原始 ID 呈现，未在本批统一；不将五个读取面通过扩大成所有 CLI 输出完全对齐。此项须继续沿相同 canonical 投影处理，不添加 permissive 别名或自研角色 prompt。

## 检查与正式交付状态

完整 `npm run check`、`npm run format:check`、`git diff --check` 通过。独立只读复核确认 Search 接线与新增 addressing 预算已解决所报问题；既有 presentedContext、Task annotation 的其他预算边界不在本批结论内。

正式 4173 先校验无活动工作，再完整备份并优雅重启，进程已替换且使用既有验证 Web build `90358c5c11a8be860739611365460391850dbdc53398c58fdfa3f86e47f03b7e`。未修改前端资源，未提交或推送。备份、进程与日志在证据目录中留存。重启后的真实 Chrome 页面复核暂被 Mac 锁屏阻挡，尚未记为通过；重启前看到的页面不能代替重启后验收。

后续解锁补验：Chrome 对正式 4173 执行真实刷新，频道历史恢复；点击 Codex 私聊读取既有消息，再返回频道，均正常。截图与步骤记录保存在 `formal-after-restart.png` 和 `semantic-formal-deployment.json`，重启后的浏览器阻塞已解除。此步骤未向正式 Agent 发测试消息。
