# ADOPT-1 结果

## Paseo 审计

1. Codex 0.171 的 `-32600` 明确拒绝按动作处理。无活动轮、`activeTurnNotSteerable` 和输出 schema 不同会将 steer 降为排队。原生中断已失去目标轮时结束该中断投递。四种错误均用假 app-server 实际回帧验证。三条降级投递随后各送达一次，四条均未产生 `delivery-uncertain` 通知。 [拒绝分类](../../daemon/codex-pipe-errors.mjs) · [inbox 与通知回归](../../daemon/hardening.test.mjs)
2. Codex 按根轮持久保存 `item/started` 中的 `commandExecution.processId`。原生中断终态为每个唯一 ID 发送一次 `thread/backgroundTerminals/terminate`，全部写入后才发下一次 `turn/start`。正常完成的轮继续保留后台进程。重放测试覆盖重复原生事件与两次 terminate 之间更换 loomd。 [轮次处理](../../daemon/codex-pipe-session.mjs) · [回归](../../daemon/codex-pipe-session.test.mjs)
3. OpenCode TUI export 上限调为 **32 MiB**，单次上限仍为 5 秒。连续 **3 次**失败后进入 `stuck`，持久记录原因和一条项目通知。成功导出后清除连续失败状态并恢复原生投影。测试用 **9 MiB** 的假导出验证恢复。 [导出](../../daemon/tui.mjs) · [状态回归](../../daemon/supervisor.test.mjs)
4. L2 工具调用给出 `completed`、`failed`、`canceled` 或 `open`。工具的显式取消与父轮中断后仍缺少终态的调用分开记录。有未结束调用的终止轮附 `facts.openCalls`。中断 fixture 同时覆盖四种状态和 `--only-failed`。 [工具投影](../../lib/turn-tools.mjs) · [活动事实](../../lib/activity-digest.mjs) · [CLI 回归](../../cli/loom.test.mjs)
5. 固定版本 OAR 0.130.1 的 `closeAcpSession` 对 `session/close` 已有 **2 秒**截止。外层 `dispose()` 还会等待终端和进程清理，Loom 对其设 **8 秒**上限。超时返回错误，未拿到关闭确认的 detached host 保留原状态。测试覆盖挂起与迟到的 rejection。 [Loom 关闭上限](../../daemon/session-close.mjs) · [detached host](../../daemon/session-host.mjs) · [回归](../../daemon/adopt-launch.test.mjs)

## 聚合器调研采纳

- **G1 请求截止。** Codex 管道 RPC 的绝对截止是 **120 秒**，储存在 checkpoint 并跨重附继续计时。未获结果的请求记为失败，会话退出；发生提前退出时也记录明确失败。已确认输入以原生证据为准。 [持久 RPC 与截止](../../daemon/codex-pipe-session.mjs)
- **G2 失败分类。** 复用固定 OAR 的 Codex 结构化轮次终态和 RPC 拒绝分类。活跃 writer 拒绝映射为 `in_use`。对明确拒绝、可以证明尚未接收的 overloaded RPC 最多重试 **5 次**，保留原业务 ID 和原截止时间。已接受后结束且报 overloaded 的轮保留原生失败。 [分类](../../daemon/codex-pipe-errors.mjs)
- **G3 停止升级。** holder 验证 controller 后向持有的 Codex 进程组发 SIGTERM，等待 **2 秒**后升级为 SIGKILL，再等待退出证据。实测忽略 SIGTERM 的子进程组由新 holder 终止，旧 controller 无法发信号。已运行的旧 pipe holder 需完成 holder 换版后才能接受新的 SIGKILL 操作。重建了 macOS arm64 与 Linux arm64/x86_64 三个制品，本机运行验证在 macOS。 [holder](../../holder/holder.c) · [信号回归](../../holder/holder.test.mjs)
- **G4 输入编码。** 先用 `toWellFormed()` 转换 Codex 输入，再计算摘要和序列化 RPC。孤立代理字符变为 U+FFFD，合法代理对保留。无法转换时给出明确拒绝。 [入站控制](../../daemon/codex-pipe-session.mjs)
- **G5 限制重发和重附。** 零字节重试保留原 holder 写 ID，单帧最多 **64 次**并受 RPC 截止控制；短写只续未写的后缀。Codex pipe 自动重附最多 **4 次**，从首个失败起最多 **120 秒**，耗尽后显示 `codex-resume-exhausted` 并报告。 [管道重试](../../daemon/codex-pipe-session.mjs) · [重附上限](../../daemon/sessions.mjs)
- **录制回放。** 用隔离 Codex 0.171.0 的原生响应构造 fixture，归一化会话标识并省略工作目录等与测试无关的信息。覆盖超时、提前退出、丢失 initialize 的写确认后重附，以及超载和后台进程的写入顺序。 [录制片段](codex-recording.json) · [回放用例](../../daemon/codex-pipe-session.test.mjs)

## Claude 启动认证

TUI 与 OAR headless 默认从子进程环境移除 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`。只有 `.project/policy.json` 对应 `roles.<role>.auth` 明确设为 `api-key` 时才保留继承的环境变量。TUI 启动参数中不传入密钥，Claude 启动拒绝 `--bare`。启动证据和 `loom status --json` 显示 `authMode`，该字段反映配置。假原生 CLI 仅记录变量是否存在，覆盖两种模式与两条启动路径。 [角色策略](../../cli/policy.mjs) · [TUI](../../runtimes/tui/transport.mjs) · [OAR](../../daemon/oar.mjs) · [启动回归](../../daemon/adopt-launch.test.mjs)

## 实机回归

绝对路径 Codex 0.171.0、隔离 HOME 和回环 mock。idle/busy 下的 loomd 升级、holder 换版及两层回滚共 **6 格**通过，原生 thread 与 CLI PID 保持，10 条投递每条确认一次，人工输入为 0。pipe 日志只有一次 initialize 和一次 thread/start 回应。 [实机矩阵](/Users/sun/Code/exp-relay/hotswap-4/r-Wgc8Nx/summary.json)

最终 `npm test` **333／333 通过**，无失败、取消或跳过。`git diff --check` 通过。更改保留在工作树，未部署到 pilot-2。 [测试日志](/Users/sun/Code/exp-relay/adopt-1/npm-test-final.log)

STATUS: done
