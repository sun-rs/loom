# HOTSWAP-4 结果

新建 Codex headless 会话使用原生 holder 的 pipe 模式。loomd 一层及 holder 一层均可在同一个 Codex app-server 进程和 thread 上升级或回滚。旧 headless 会话沿用原 session-host、进程和发布根。

## 实现

- holder 从出生起持有独立的 stdin、stdout、stderr pipe。stdout 和 stderr 各自有绝对偏移，按统一事件序号写入日志。控制面以 controller epoch、水位、write ID、字节范围和摘要执行写入 CAS。pipe 模式无 TUI 人类输入门限。信号和 `waitpid` 结果保留在 holder。换版通过同 PID `execve` 传递允许继承的 fd，TUI 继续使用原有 v3 交接格式。 [原生 holder](../../holder/holder.c) · [wire 解码](../../holder/protocol.mjs)
- loomd 持久化 JSON-RPC 的 UTF-8 帧尾、stdout/stderr 游标、初始化阶段、thread ID、下一请求 ID、请求关联和活动轮。它先落盘帧和原写入 ID。重附后查同 ID 回执，可证明零写入才重试已准备的字节，明确短写时只发其后缀。未知写入或日志缺口冻结输入。原生用户事件沿用业务投递 ID，投影事件经持久 outbox 和事件 ID 去重。 [RPC 实现](../../daemon/codex-pipe-rpc.mjs) · [Codex 状态与轮次](../../daemon/codex-pipe-session.mjs)
- 发布摘要覆盖 adapter、holder 源码、三个平台二进制及能力清单。pipe handoff 预检要求候选镜像支持 pipe 模式，交接后核对 build、generation、holder PID、CLI PID 和协议身份。macOS arm64 在本机运行验证，Linux arm64、x86_64 完成交叉编译及摘要验证。 [发布摘要](../../daemon/release.mjs) · [能力清单](../../holder/bin/pipes) · [换版预检](../../daemon/native-holder.mjs)

## Codex 实机矩阵

使用绝对路径的 Codex 0.171.0、隔离项目与 HOME、回环 mock。busy 三格在同一轮的 9 秒 mock 响应期间完成换版，随后检查旧轮和下一次投递。六格均保持 thread ID、Codex PID、holder PID、stream ID 和 incarnation，每条输入在 Codex 原生 transcript 与 Loom 投影各确认一次，人工输入为 0。

| 状态 | loomd 升级 | holder 换版 | loomd 与 holder 回滚 |
| --- | --- | --- | --- |
| idle | 通过 | 通过 | 通过 |
| busy | 通过，1,441 ms | 通过，607 ms | 通过，1,731 ms |

计时从 mock 收到请求开始。整组共 10 条不同的投递，重复 0、丢失 0。原生 pipe journal 只有一个 `initialize` 回应（ID 1）与一个 `thread/start` 回应（ID 2）。stdout 73,792 字节，stderr 314 字节，水位各自连续。 [矩阵及原生记录路径](/Users/sun/Code/exp-relay/hotswap-4/r-ceEhti/summary.json) · [逐格日志](/Users/sun/Code/exp-relay/hotswap-4/r-ceEhti/codex/steps.jsonl)

## 兼容与验证

- 共存测试加载旧 OAR Codex v1 会话，新 loomd 延续原 host 实例和原生 thread 后，另起 pipe v3 会话。旧 loomd 回滚只被活跃的 protocol 3 会话阻止，旧 holder 因缺少 pipe 能力清单被预检拒绝。 [共存记录](/Users/sun/Code/exp-relay/hotswap-4/r-qzti8A/summary.json)
- 基线 `d29515e7` 先应用 PILOT2-FIX-2 的独立补丁，再叠加本卡的实现。隔离工作树的暂存区含独立补丁，工作树含 HOTSWAP-4，未提交。两层均通过 `git diff --check`，合并后的 `npm test` 通过 **316／316**，无失败或跳过。RPC 回归覆盖跨帧 UTF-8、独立 stderr 偏移、请求关联、短写、零写入和缺口。holder 测试覆盖 pipe fd、原生退出码及旧镜像拒绝。 [独立补丁](../PILOT2-FIX-2/fix.patch) · [组合工作树](/Users/sun/Code/exp-relay/hotswap-4/layer-yk1x8yzo/worktree) · [测试日志](/Users/sun/Code/exp-relay/hotswap-4/layer-yk1x8yzo/npm-test.log) · [RPC 回归](../../daemon/codex-pipe-rpc.test.mjs) · [holder 回归](../../holder/holder.test.mjs)
- 验证范围为计划内交接。holder 被 `SIGKILL` 时，唯一持有的 pipe fd 可能丢失。日志缺段与不明写入保持冻结。Linux 实机和剩余三家 headless provider 的换版矩阵尚未运行。

## 剩余 provider

**agy ACP。** 当前保留 v1/v2 session-host。pipe adapter 需持久化 ACP 初始化协商、`session/new`、根原生会话槽、请求 ID 及转向和取消关联。重放 `session/update` 时分离根轮与子工具，结合根 `PreInvocation` 和完整原生 transcript 核对收到的正文。权限请求与工具结果沿用各自原生 ID，验证未确认请求、流式输出和忙时取消。

**OpenCode ACP。** 当前保留 v1/v2 session-host。需要持久化 ACP 协商及可用的 steering 能力、请求和原生 session/turn 关联，在原连接上重放 `session/update`，`session/load` 用于另起进程的恢复。工具、子会话及权限响应需要独立归属，用原生导出验证终局和业务投递的原始 ID。

**Claude stream-json。** 当前保留 v1/v2 session-host。pipe adapter 需持久化 `--input-format stream-json --output-format stream-json` 的 SDK 初始化阶段、`control_request`／`request_id`／response、native session ID、用户轮、增量内容和 `result`。保留权限及 MCP 握手的未决响应，由原生用户记录和终态校验业务 ID。验证切换后不重复初始化、提交或回复权限。

STATUS: done
