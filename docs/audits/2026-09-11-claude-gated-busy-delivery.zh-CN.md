# Claude 工具边界追加与 Kimi 接口差异

本批接续 Codex native busy。顺序仍为原生忙时投递、严格双边组合复验、UI；本批不改变 Room、Inbox、ACK、Task 或记忆所有权。

## 上游依据与采用边界

Raft Computer 1.0.18，提取路径 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- 736148：并发工具结束到零才释放 tool batch。
- 736184、736577、768770：压缩期间阻止写入，在安全边界检查 pending 通知。
- 758145：Claude 使用带 session_id 的 stream-json user/text 帧。
- 769235：只有 transport send 成功才登记已写通知。
- Multica `server/pkg/agent/claude.go:143` 同样保持 stdin 开放；这里只作实现交叉参考，没有从中引入业务状态。

RAH `claude-busy-input.js` 是结构移植，非逐字复制。复用既有 Host 只读 Inbox 通知、认证 supervisor 管道和传输回执；通知只包含待查目标/数量，不代替 Worker 读取。

本地适配：以工具 ID 集合处理重复 tool_result，避免并行工具提前释放；单个待发传输快照保留到工具边界，由 Host 新请求替换；停止刷新 5 秒后过期，不另建持久队列。5 秒是 RAH 适配参数，覆盖正常 2.5 秒轮询/回执周期，不是 Raft 常量。父请求超时只表示未确认，不能当作确定未写。工具完成后至下一次模型继续之间保留边界窗口，防止 Host 读取与工具完成事件错开。压缩、错误、会话失效、终态均阻止注入。同步写异常及异步失败不会被记成成功；回调未完成的重复请求不能提前返回成功。

`claude-stream-json-driver.mjs` 不再发送初始输入后立即关闭 stdin。第一条 result 关闭新的追加入口，已写入管道的输入允许排空；结果数上限为初始输入加实际成功写入通知数，早期失败不会被后续成功掩盖。这是 RAH 有限 Run 生命周期适配，**没有完成 Raft 跨 Activation 常驻进程模型**。

## 分级验证

- TDD：工具批次、compaction、终态拒绝、超时、明确失败后重试、回调前重复、边界窗口，以及真实子进程假 Claude 的双结果排空；先观察失败，再修复。原 resume/身份漂移/取消测试保留。
- 第一轮真实 Sonnet/low：原回复与追加在原 Run 内各一次，但未找到原生注入证据，因此不计原生投递通过。
- 第二轮真实 Sonnet/low：transport 成功与 Claude `attachment/queued_command` 原生记录相互印证；追加 06:41:43.459Z，原生输入 06:42:12.990Z，原回复 06:42:21.003Z，追加回复 06:42:23.372Z。约 39.9 秒包含原指令的 sleep 30，不能与不同条件的 Raft 22 秒直接比较。
- 第三轮把原生回执作为硬断言后失败，暴露一秒快照过期与 Host 轮询之间的空窗；业务仍正常，不能据此豁免底层缺陷。新增 fake-clock 反例后改为上述单快照续期。
- 最终代码真实 Sonnet/low gate 通过：追加 06:47:53.339Z；原生 queued_command 06:48:23.188Z，原 Run transport 回执成功；原回复 06:48:28.482Z，追加回复 06:48:31.244Z，各一次，原生输入恰好一条。原 Run 与后续空 Run 最终均 exit 0。约 37.9 秒含原指令 sleep 30，不代表无等待任务的延迟。
- 最终证据：[real-final.json](/Users/sun/Code/reviews/rah_os/2026-09-11-claude-busy/real-final.json)；失败反例：[real-boundary-miss.json](/Users/sun/Code/reviews/rah_os/2026-09-11-claude-busy/real-boundary-miss.json)。
- 最终 `npm run check`、`npm run format:check`、`git diff --check` 全部通过。日志在上述同一证据目录。
- 正式实例空闲后完成 state 与 council 工作区/记忆备份，旧进程 68622 优雅退出，新进程 90226 提供 4173。沿用此前冻结且本批未修改的 Web 构建 `90358c5c11a8be860739611365460391850dbdc53398c58fdfa3f86e47f03b7e`。
- 新 Chrome 页面（1440×900，DPR 2）验证 Room 历史、Codex DM 切换、刷新后消息及返回 Room；无 pageerror，截图已人工审阅。证据目录 `formal-browser.json`、`formal-room.png`、`formal-dm.png`、`deployment.json`。这只是正式本地浏览器验证，不是 Raft 双边验收。
- 本批未 commit、push。

第二轮原始证据在 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-native-busy-claude-ZPy9HB/evidence.json`。测试只抽取 queued_command 和调用模型/effort 元数据，不展示模型推理。

## Kimi 的明确未收口差异

Raft 旧 Kimi driver 在 760463 使用 wire `steer`，idle 才 `prompt`；741444 启动 `kimi --wire`。当前 canonical `kimi-sdk` 在 760602 调用 `session.steer`，SDK 版本为 `@botiverse/kimi-code-sdk@0.34.0-botiverse.0`（101700）。

RAH 调用用户安装的 `kimi acp`。本机 `@moonshot-ai/kimi-code 0.39.1` 的 ACP `assertNoActiveTurn`（363459–363479）明确拒绝并发 prompt，注册表（363906）没有 steer；CLI help 也没有旧 wire 开关。安装 bundle SHA256 为 `ed24f532d07e5d00777ae20b42ed18437e116b050bbcfc6ae0f3bc90affca337`。

因此本批不伪造 Kimi busy 支持。它仍通过 durable follow-up 处理追加；这不等于 Raft direct。真正补齐需要受支持的 steer 控制面，或明确引入独立 SDK Runtime。后者涉及现有“只调用用户安装 CLI”的产品边界，不能静默替换、修改用户 CLI，或从压缩 bundle 动态抽取私有对象。

## 剩余边界

- Kimi 原生 steer；跨 Activation 的常驻会话模型。
- 已读完追加后仍启动一次空 follow-up 的 Kernel 收敛；本批不让传输成功冒充业务 ACK 来掩盖它。
- 同 CLI/model/effort/触发条件的 Raft 双边多轮、双 Thread、跨 Room/DM 和重启组合复验。
- UI 后续顺序保持不变；没有因本批测试宣布整体前后端对齐。
