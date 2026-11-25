# HOTSWAP-2 Phase A 结果

基线 `4aa5a826`。推荐用精简的原生 holder 持有 fd，业务状态在 loomd 内重建。升级 holder 时在原 PID 上 `execve` 新版本。普通用户已在启用 SIP 的 macOS arm64 上验证内层 PTY、hc 外层终端和 headless 管道可以延续。另起 PID 并结束旧 holder 也能传递 fd，但 hc 会结束原窗格，接手进程也无法 `waitpid` 原生子进程。四个 TUI 的屏幕重建均通过逐格比较。产品代码未改动。Phase B 的 v3 接线、Linux 运行验收和完整升级矩阵尚未执行。[研究](../../docs/research/2026-11-25-hot-upgrade.md) · [HOTSWAP-0](../HOTSWAP-0/RESULT.md) · [HOTSWAP-1](../HOTSWAP-1/RESULT.md) · [TUI-ORCA-1](../TUI-ORCA-1/RESULT.md) · [协议 v2](../../docs/PROTOCOL-v2.md)

## 1. 函数清单和边界

H 代表必须随 OS 资源留在 holder 的部分，D 代表由 loomd 执行的部分。表中已拆开的函数名指现有实现，移动时可拆分接口。清单包含两个进程直接执行的入口、回调及其会话处理模块；只在 loomd 调用的 launch/attach 函数列在交界处。

### `loom-pty`

| 当前函数或回调 | 去向 |
| --- | --- |
| `loom-pty.main` 的 `--version`、参数及 provider 校验、模块选择、`startPath`/`exitPath` 证据写入与启动/异常投影 | D。H 接受已经解析的绝对 argv、环境和几何，报告启动或退出事实。 |
| `main` 的 raw mode 设置/恢复和监听器生命周期，`resize`、`human`、`abort`、`terminate`、`hangup` | H。继承 hc 外层 fd，转发输入、`SIGWINCH`、SIGINT 对应的原始 `0x03`、TERM/HUP，并保持内层进程组身份。 |
| `thinBackend.launch` 的 `pty.spawn`、`exited` 及其 resolver、`exitListener`、`fromPty` 的二进制输出和镜像、`onDrain`、`write`、`writeHuman`、`resize` 中的 TTY ioctl、`signal`、`close` 中的 fd/进程清理 | H。逐字节写 ring、计数、记录退出码/信号，处理短写、外层回压和 EOF。启动配置、关闭意图及超时策略由 D 管理。 |
| `thinBackend.launch` 的 xterm 构建、`parsed` 队列、`onTitle`、`onBufferChange`、`fromGrid`、`fromPty` 中的解析与 `echo` 匹配、`read`、`resize` 中的 reflow、`close` 中的 parser 清理 | D。`readGrid` 和 OSC 标题由同一个有序流计算。在 hc 镜像模式由外层终端响应查询。非镜像模式才由 loomd 内 xterm 回复，回复也经过传输层。 |
| `thin` 的 `guardAge`、`stale`、`humanActive`、`valid`、`writeIf`、`key` | D 决定 quiet 时间、可写条件、按键、分段粘贴和何时 Enter。H 只维护原始计数和单调时钟，提供最后一次写入的原子条件检查。 |
| `index.bindTuiSession` 的 `classify`、`heldComposer`、`sameInterruptedTurn`、`serialize`、`observe`、`recoverStartup`、`read`、`until`、`receipt`、`confirmations`；返回的 `readState`、`submit`／`canWrite`、`interrupt`、`dialog`、`waitExit`、`close`，以及 `refusal`、`digestOf` | D。包括状态合成、重试与放行、启动/信任/overlay、干预菜单、轮身份检查、请求序列化、收到原生证据后的去重，以及 staging 清理。 |
| `pty-grid.undimmedText`、`readGrid`、`rowText`；`agent-input.denied`、`sameInput`、`bracket`、`agyPasteSegments`、`submitAgyComposer`、`submitComposer` 与其 `held`/`showsPaste`/echo 回读；`composer-draft.normalize`、`digest`、`draftExpectation`、`verifyDraft` | D。维护字体/颜色属性、光标/文本、分段 Agy 草稿、占位符、跨输出匹配和粘贴后的读回校验。 |
| `agent-status.titlePhase`、`currentTitle`、`isDialog`、`isStartupBlocker`、`isFailure`、`blocksInput`；`providers.content`、`agyScreen`、`input`、`activity`、`hookObservation`、`hostPhase`，各 provider 的 `start`、`hook`、`transcriptRow` 和 `screen` 适配方法（分类、草稿、空/持有 composer、对话框按键、干预计数） | D。继承的 `launch`/`screen` 等适配器函数、`agentResumeArgs`、hook 捕获脚本也由 D 配置和消费，hook 脚本仍由 CLI 触发。 |
| `native.inside`、`nativeState` 内的 `at`、`hooks`、`record`、`validTranscript`、`read`、`confirmations`，以及 hook/transcript 的 `jsonlTail` 游标；`request-book.entries`、`readRequestBook`、`openRequestBook`、`put` | D。维护路径和 session/turn 绑定、来源合并、原生回执和持久化请求账本。 |
| `pty-control.receive`、`listenControl` 的 socket 验证、接受连接、限长、超时和回收，及其 `hello/state/submit/interrupt/dialog/confirmations` 路由 | 私有 socket、身份和小帧生命周期的通用部分为 H（v3 实现）。这些旧方法及 `controlHello`、`requestControl` 在 D 的 v0–v2 兼容路径保留。 |
| `index.createTuiHost` 的 `launch`、remote `close`；`backends.hcBackend` 与 `hcWrappedBackend` 的 `launch/read/status/close`、`request/readExit`、remote `hello/readState/submit/interrupt/dialog/confirmations/waitExit` | D 侧交界。新模式由 D 准备证据目录、绝对命令、hc 启动参数和 v3 连接，老模式继续走旧调用。 |

[入口](../../tui/loom-pty) · [thin](../../tui/thin.mjs) · [会话控制](../../tui/index.mjs) · [控制 socket](../../tui/pty-control.mjs) · [网格](../../tui/pty-grid.mjs) · [输入](../../tui/agent-input.mjs) · [草稿](../../tui/composer-draft.mjs) · [状态](../../tui/agent-status.mjs) · [provider](../../tui/providers.mjs) · [证据](../../tui/native.mjs) · [请求账本](../../tui/request-book.mjs) · [backend](../../tui/backends.mjs)

### `session-host`

| 当前函数或回调 | 去向 |
| --- | --- |
| `session-host.main` 的绝对启动计划检查、`owner.json` 独占占位/取消、创建服务器、链式 dispatch、监听/清理、350 ms timer、信号和失败回调 | D 管理 launch/owner 元数据、JSON/业务 RPC、timer、失败和取消记录。H 仅拥有子进程及管道、传输身份、单调写者租约、fd 生命周期、信号、回收和退出事实。 |
| `oarVersion`、`refused`、`save`、`checkTranscript` 及其候选定位回调、`state` | D。OAR 版本/模型/effort/steer/活动轮投影，原生记录路径、请求去重和 `pending → accepted/refused/uncertain`，由 D 持久化。 |
| `close` 内的 `session.dispose`、`checkTranscript`、`runtime.unsubscribe`、`ended.json` 及延迟清理 | D 发出协议关闭并保存证据，H 保证流关闭、信号传递和 `waitpid` 一次。独立处理 stdout/stderr 各自 EOF 和退出事实。 |
| `handle` 的 `hello`、`claim`、`state`、`close`、`receipt`、`control` | `state`/请求验证、摘要、账本、`prompt/steer/abort` 轮校验和回执由 D 实现。`hello/claim` 的传输身份与单写者 fencing 为 H。旧调用仍走冻结的 legacy host。 |
| `oar.checkedTranscript`、`openOar`、`bindOarTranscript`、`trackOar`（`append`、`onEvent`、`clearInactive`、`sampleInputHead`、`noteAbort`、`error`、`suspend`、订阅回调）、`oarSnapshot`、`oarEnd`、`oarDelivery`、`oarControl` | D。原生进程的启动 syscall 和 fd 归 H，OAR/native 握手、解帧、轮槽、输入 ID、控制命令、证据采集、repo HEAD 对账和订阅归 D。 |
| `host-control.hostDirectory`、`readJSON`、`hostSocket`、`privateHostSocket`、`receiveHostLine`、`hostRequest`、`hostHello`（含失败回调） | D 保留旧 host 客户端与目录元数据；H 提供 v3 专用 Unix socket 和有界帧读取，持有端做权限/所有者核验。 |
| `host-client.lastExit`、`attachHost`（`connect`、`call`、`verify`、`readRows`、`pull`、session/rows/endedAt/transcriptPath getter、`active/error/receipt/control/close`） | D 侧交界。继续验证旧会话的 incarnation、发布根、PID 启动身份、native ID；v3 用分开的 lease/replay 客户端。 |

[Headless 宿主](../../daemon/session-host.mjs) · [OAR 投影](../../daemon/oar.mjs) · [传输协议](../../daemon/host-control.mjs) · [客户端](../../daemon/host-client.mjs)

### 写入的时序约束

当前 800 ms 保护在 `thin.writeHuman` 收到外层输入时开始，`read` 的 `generation` 会因输出、输入、尺寸、退出或自动写变化。跨进程后，D 等待 quiet、检查空 composer、粘贴、核对回读并决定是否 Enter。每个分段粘贴、dialog key、Enter 和 terminal reply 都单独提交 `{epoch, eventSeq, outputOffset, humanInputOffset, minHumanQuietNs, bytes}`，其中 `eventSeq` 覆盖 resize、其他写和 exit。只有自动 composer/按键传 `800_000_000` ns，值由 D 选择。D 还可在自己的快照上判定 120 ms 输出/resize quiet。

H 在同一个非阻塞事件循环中处理已就绪的人类输入、CLI 输出和 resize，再核对 token、退出状态和 `CLOCK_MONOTONIC` 的 human quiet。条件比较与第一次非阻塞 `write` 之间没有异步步骤。线性化点是 holder 读到 fd 上字节的顺序，无法承诺键盘硬件事件尚未到达时的顺序。`EAGAIN` 且未写入要重新核对 guard。出现短写时记录已写入的前缀，继续同一原始操作前复核边界，遇冲突报告具体前缀长度和 `partial`，D 冻结此 composer 并做原生证据对账。新的 Enter 需要新鲜的 frame 和独立 token。holder 不解释载荷，也无需持久存储人的按键内容。[现有 byte-time 检查](../../tui/thin.mjs) · [现有粘贴/提交次序](../../tui/agent-input.mjs)

## 2. Spike 1 — 四个 TUI 的逐格重建

在 `/Users/sun/Code/exp-relay/hotswap-2/` 的基线副本给 live `thinBackend` 接入仅用于实验的 2 MiB ring，记录原始数据、起始几何、绝对偏移和有序 resize。独立进程 A 回放同一份 ring。等本地 mock 已收到测试输入且延迟响应时，SIGKILL A，在这段间隔中把内层从 200×120 改为 99×33，再由全新 PID 的进程 B 从出生偏移重新建立 `@xterm/headless@5.5.0`。网格比较覆盖 normal/alternate、scrollback、每格字符/宽度/样式/颜色、wrapped 标志、光标、视口、模式和标题。四个 CLI 均保持原 native PID，hc 地址、PID、创建时间和 `live` 状态均保持，四个原 mock 轮均在 B 建好后显示结果。B 代表 loomd 的网格读取器；整套候选 loomd 的 live upgrade 留给矩阵验收。[运行器](/Users/sun/Code/exp-relay/hotswap-2/grid-lab.mjs) · [复建与比较](/Users/sun/Code/exp-relay/hotswap-2/grid-replayer.mjs) · [逐项原始结果、PID 和摘要](/Users/sun/Code/exp-relay/hotswap-2/grid-summary-r4.json)

| CLI | 本地 mock | A／B 比较格数 | 差异 | 进程切换和 resize 后新输出 |
| --- | --- | ---: | ---: | ---: |
| Claude | Messages | 48,000／6,534 | 0／0 | 1,923 B |
| Codex | Responses | 24,000／3,366 | 0／0 | 3,060 B |
| agy | Chat Completions | 24,000／3,267 | 0／0 | 1,988 B |
| OpenCode | Chat Completions | 24,000／3,267 | 0／0 | 1,213 B |

四个原生 CLI 都通过绝对路径启动，各有独立 HOME、临时目录、仓库和假 token。OpenCode 额外用原生二进制的独立副本复跑，进程的 Seatbelt 阻断旧配置目录和非 loopback 出站，比较 24,000／3,267 格仍为 0／0，收到同一在途轮的结果。所有窗格均由实验创建并回收。[OpenCode 隔离复跑](/Users/sun/Code/exp-relay/hotswap-2/grid-summary-r5.json) · [OpenCode 自定义 provider](https://opencode.ai/docs/providers/#custom)

**重放边界。** 四组样本都保留偏移 0。另一个最小反例丢掉 `ESC [ 3 1` 四字节前缀，仅从 `mX` 回放，得到默认色 `mX`；完整流得到红色 `X`。因此 v3 首版在 ring 外保留分段原始日志，从出生开始回放。读取断档显式返回 `gap`。如果以后引入 checkpoint，需证明 decoder/parser 的未完成 UTF-8、CSI/OSC/DCS、mode、活动及非活动 buffer、attr 与 reflow 等状态可恢复。xterm 的序列化 escape stream 没有这种完整 checkpoint 契约；不能用网格截图替代。解析回放只消费原始 resize 事件，读取快照时不向 `grid.write` 注入额外操作。[反例与输出](/Users/sun/Code/exp-relay/hotswap-2/gap-summary.json) · [xterm SerializeAddon 源码](https://github.com/xtermjs/xterm.js/blob/5.5.0/addons/addon-serialize/src/SerializeAddon.ts)

## 3. Spike 2 — fd 交接与 hc 外层

在 macOS 26.6.2 arm64、UID 501、SIP enabled 上运行 166 行 C 探针。PTY 分支经 `forkpty` 启动原生子进程，headless 分支经 `pipe`/`dup2` 连接进程的 stdin/stdout。两个带不同 build marker 的可执行文件跨版本继承内层 fd、日志 fd 和外层 fd 0/1/2。带 `spawn` 的探针由新 PID 确认已经继承和启动后，旧 PID 才退出。`exec` 保留原 PID、启动身份、父子关系和 session/进程组。探针用 2 ms 间隔写出 1,200 条编号记录，核对偏移、顺序和 `ACK before`/`ACK after`，同时观察 HUP。间隔是旧版本记录 cut 到新版本首次成功 `read` 的单调时钟差，包含调度与等待下一个字节。[C 探针](/Users/sun/Code/exp-relay/hotswap-2/holder.c) · [运行器](/Users/sun/Code/exp-relay/hotswap-2/handoff.mjs) · [两轮数据](/Users/sun/Code/exp-relay/hotswap-2/handoff-summary-r4.json) · [前两轮原位基线](/Users/sun/Code/exp-relay/hotswap-2/handoff-summary-r3.json)

| 模式 | 样本 | cut→首次读到数据 | 截断处／完整性 | 持续性 |
| --- | ---: | --- | --- | --- |
| hc + 内层 PTY，原 PID `exec` | 4 | 3.208、3.271、3.654、364.218 ms | 每轮 14,443 B。cut 前后偏移相等，0 丢、0 重复、无乱序 | 原窗格 `live`，`ACK after` 出现在同一窗格，child PID 不变，无 HUP，退出码 0。最大值在新文件的第一次换入中出现；未归因。 |
| headless pipes，原 PID `exec` | 4 | 2.771、3.815、4.158、4.452 ms | 每轮 14,443 B。0 丢、0 重复、无乱序 | stdin/stdout 双向继续，两个 ACK、相同 child PID，无 HUP，退出码 0。 |
| hc + 内层 PTY，启动新 PID 后旧进程退出 | 1（带 READY） | 4.636 ms，测自 holder 日志 | 14,433 B；1,200 条编号记录全到，0 丢、0 重复、无乱序 | `hc` 将原窗格置为 `finished`，续写 ACK 无法送到该窗格，holder 观察到 HUP，CLI 未收到 HUP 并写出 END。新 holder 的 `waitpid` 返回 `ECHILD`。 |
| headless pipes，启动新 PID 后旧进程退出 | 1（带 READY） | 4.134 ms | 14,433 B；1,200 条编号记录全到，0 丢、0 重复、无乱序 | 原子进程继续，未收到 HUP。Node 端尝试续写，只有 `ACK before`；新 holder 的 `waitpid` 返回 `ECHILD`。 |

实际 Codex `app-server --listen stdio://` 又在 busy 轮上验证 `exec`。先 `initialize`/`thread/start`，等 loopback mock 收到一次 `turn/start` 的请求后再换，随后原 `turnId` 收到 `turn/completed`。`threadId`、CLI PID、holder PID 不变，读边界 `5902 → 5902`，启动间隔 4.235 ms，首次读回 20.555 ms。同轮 mock 请求计数为 1。这里验证的是原生 stdio 接续，OAR 尚未接入新传输。[活动轮、PID 和偏移证据](/Users/sun/Code/exp-relay/hotswap-2/handoff-summary-r4.json)

**node-pty 与实现成本。** 锁定的 v1.1.0 Unix 实现有 `fd` getter，可把已有 master 当作整数 fd 传给子进程。其公共 `IPty` 接口没有接管已有 master 的 API；构造器调用 native `fork`，`open` 分配新 master/slave 对。直接包 fd 也不会重建 node-pty 的 `waitpid`/child 状态。建议原生 C holder 从会话创建起拥有整个 fd 生命周期。TUI 使用 `forkpty`、`poll`、`TIOCSWINSZ`、`kill`/`waitpid`，headless 使用 `pipe`/`dup2`，产品版为 stderr 单独保留流。[node-pty Unix 源码](https://github.com/microsoft/node-pty/blob/v1.1.0/src/unixTerminal.ts) · [node-pty 公共类型](https://github.com/microsoft/node-pty/blob/v1.1.0/typings/node-pty.d.ts) · [forkpty](https://man7.org/linux/man-pages/man3/forkpty.3.html) · [execve](https://man7.org/linux/man-pages/man2/execve.2.html)

| 探针产物 | 编译参数 | 文件大小 | 本机实测构建 |
| --- | --- | ---: | ---: |
| macOS arm64 Mach-O | Apple Clang `-Wall -Wextra -Werror -Os`，链接系统库 | 35,640 B | 0.09／0.07 s |
| Linux arm64 ELF | Zig 0.15.2 `cc -target aarch64-linux-musl -Os -static -s` | 35,552 B | 5.30 s |
| Linux x86_64 ELF | Zig 0.15.2 `cc -target x86_64-linux-musl -Os -static -s` | 29,128 B | 4.85 s |

Linux 两个静态、已 strip 的 ELF 均从本机交叉编译，使用经 Zig 官方 SHA-256 核验的工具链。Linux 尚无运行时证据，Phase B 用目标系统的真实 PTY 和管道跑测试。发布目录按 OS/arch 放独立二进制，校验摘要、可执行位和 schema，目标机器无需编译器和 Node addon。glibc 构建可选用 `<pty.h>` 和 `-lutil`。[mac 构建日志](/Users/sun/Code/exp-relay/hotswap-2/mac-build.log) · [Linux 构建日志](/Users/sun/Code/exp-relay/hotswap-2/linux-build.log) · [Zig 工具链](https://ziglang.org/download/)

## 4. Holder v3 设计

### 冻结接口和重建

使用产品管理目录下独立的 v3 Unix socket。目录 `0700`、socket/日志 `0600`，校验项目、incarnation、Unix peer UID（Darwin `getpeereid`、Linux `SO_PEERCRED`）和注册控制器。可用固定头部和长度前缀的有界帧表示方法号、版本和二进制 payload，首版建议单帧 64 KiB，读分批。每个 session 有不可变 incarnation、holder `buildId`/`generation`、单写者 `epoch` 和全序 `eventSeq`。输出 stdout/stderr 分别用 64 位绝对字节偏移，按 `<stream, offset>` 连续消费，退出和每流 EOF 单独记录。通用事件只有 bytes、resize、input-counter/write result、EOF 和 exit；流数据保持原始字节。

| 方法 | 请求与返回 |
| --- | --- |
| `hello`、`claim` | `hello` 返回协议、能力、启动身份、child PID、build/holder generation 和日志区间。`claim` 核对已登记的新控制器代号并递增 epoch，过期 writer 被隔离。`hello` 不改变 epoch。 |
| `snapshot`、`read` | snapshot 给出原子 watermark（初始/当前尺寸、`eventSeq`、各流 off/earliest、已镜像偏移、输入计数、最后输入时间、exit 含信号）。`read(afterEventSeq, maxBytes)` 从对应记录校验各流偏移并返回有序批次；找不到起点返回 `gap` 与日志段定位。读可从标记点追上当前，重复连接允许重复读取，由偏移去重。 |
| `write` | 用第 1 节的 CAS 条件和 idempotency ID，返回 `applied`、`stale`、`busy-human`、`would-block`、`partial`、`exited`、`unknown` 及已写字节范围。`write(id)` 的传输回执可查询/重放，不等同于 provider 收到或进入轮次。重连时同一 ID 加 payload 摘要防止重复写。 |
| `resize`、`signal` | 控制器经 epoch 检查设置几何或发白名单信号；外层 TTY 的尺寸变化走相同事件路径。几何记录排在 ioctl 触发的重绘前。退出状态可由 snapshot/read 取到。 |
| `handoff` | 管理面只接收已核验清单里的候选 build/schema、事务 ID 和预期旧 generation。实现第 3 节的同 PID 原位切换。它与输入命令分队列和授权。 |

首版保留会话出生以来的分段原始日志与快速 ring。独立记录 `mirroredOffset`，在确认向外层 fd 实际写出后才前移。重建流读取日志，既不向 hc 重播已经显示的数据，也不因 daemon 断开停止采集。给单项目和每会话设磁盘额度及告警；发生 I/O 错误或缺段时保留终端的人类交互并冻结自动写，汇报明确的 `gap`，保留退出通路。日志与写回执按版本、权限及保留周期管理。输出可能含用户数据，禁止将原始日志作为诊断自动上报。单进程 `exec` 时保留 journal fd 和版本化 manifest；`SIGKILL` 可能同时失去唯一 master 和未同步尾段，不能把进程崩溃承诺成无损迁移。

### 两层升级、回滚和兼容

1. **loomd 升级。** 沿用 `selfCheck`、`verifyRelease`、`planUpgrade`、`beginUpgrade`、`validateHandoff`、`validateReattachment` 和 `handoff` 的候选校验、交接锁、失败回切。在 v3 分支，旧 D 停止发新业务写并落盘 transport/业务事务和消费游标。新 D 以更高 epoch 接管，重放到可验证 watermark，连同 hc 身份、native session/stream 和待确认输入校验后开放写。只有整组会话核验通过才提交 active release 指针。[现有升级流程](../../daemon/upgrade.mjs)
2. **holder 换版。** 预启动旁路 `--self-check` 校验目标二进制和 manifest 兼容范围。旧映像停收控制写，在明确的 syscall 边界记录绝对读/写/镜像进度、事件计数、最后人类输入时间、退出/信号状态、过程身份及 fd 清单。保留外层 stdio、内部 master/pipe、日志、Unix listen fd，只在白名单 fd 上清 `FD_CLOEXEC`。旧控制连接按 generation 重连。新版从继承 fd/manifest 建立 poll 和信号处理后发布 READY，继续读内核缓冲。旧映像若遇 `execve` 同步失败则解除冻结；成功后由兼容的新映像用相同步骤换回固定的上一版。对 bootstrap 做故障注入，候选成功 exec 后、建立恢复能力前若崩溃，只有独立持有 fd 的保活方案才提供硬故障恢复。Phase B 必须明确该窗口并测试预检和回切，不向用户承诺保留已消失的 fd。
3. **Headless 业务接管。** OAR 0.130.1 的公开 `SessionOptions`/`Runtime.session()` 缺少已开 transport 的注入和重附入口。需要跟 OAR 对齐增量接口，或维护版本化的 Loom 端 transport adapter。Codex app-server 使用原有 JSON-RPC 连接，agy/OpenCode 使用各自原 ACP 流，Claude 使用现有 runtime 的 stream-json。D 持久化 native 连接初始化是否完成、provider session/stream ID、RPC 请求 ID 和关联、轮状态、子流和原始读游标。恢复从日志重新投影并重建等待关系，已发出的 `initialize`/`session/new` 不重复发。需要确认的业务请求沿用现有请求 ID 和原生证据；只有明确零字节且 provider 未接收时才可重发。权限回复/工具调用也遵循该规则。每个 provider adapter 需专项验证分流和待完成请求。[现有 OAR 调用](../../daemon/oar.mjs) · [v2 的输入与原生证据语义](../../docs/PROTOCOL-v2.md)
4. **迁移。** 发布清单同时广告可读 v0/v1/v2/v3 能力，新会话按 backend 启用 v3。当前 TUI 服务默认 v1，客户端兼容 0/1/2；headless 服务默认 v1，保留 v1/v2 包络和客户端。已有 v0/v1/v2 继续绑定原发布根和原 PID，保留其 socket、宿主和发布目录，直到会话自然退出再清理。不尝试将活着的 Node wrapper 的 fd 移交给 v3，也不销毁原窗格以制造所谓重附。有活跃 v3 时，只能回滚到同时能接管 v3 的 release；不兼容回滚沿现有 blockers 拒绝，保持运行中会话。[TUI 协商](../../tui/pty-control.mjs) · [Headless 协商](../../daemon/host-control.mjs) · [现有版本 blocker](../../daemon/upgrade.mjs)

### Phase B 验收矩阵

每格分别跑 TUI 与 headless，合计 48 次（4 CLI × 2 状态 × 3 操作 × 2 backend）。回滚用已验证相容的上一版，验证 daemon 与 holder 两层回到上一 build。busy 在同一个 9 秒本地 mock turn 的请求已到达后操作，验证原轮完成和入站输入只消费一次。idle 在无轮运行但有已确认输入时操作，换版后传下一条输入。

| CLI | idle／daemon 升级 | idle／holder 换版 | idle／回滚 | busy／daemon 升级 | busy／holder 换版 | busy／回滚 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude | Messages/stream-json | 同左 | 同左 | 持续同轮，检查 Stop | 同左 | 同左 |
| Codex | TUI/Responses 与 app-server | 同左 | 同左 | 检查 thread/turn 完成 | 同左 | 同左 |
| agy | TUI/Chat 与 ACP | 同左 | 同左 | 检查 ACP 轮槽和流式草稿 | 同左 | 同左 |
| OpenCode | mini/Chat 与 ACP | 同左 | 同左 | 检查 ACP 会话和回复关联 | 同左 | 同左 |

每格比较原生 session ID、CLI PID、TUI 的 hc 地址/PID/创建时间，检查没有手动输入、确认窗口、重新登录或重启。记录切换前 N 条及之后 M 条带唯一标记的业务回执，逐项比对 `N + M` 次原生确认、偏移和终态，数出丢失/重复/乱序。附加用例覆盖正在键入的 800 ms guard、交叉 resize/UTF-8/alt-screen/OSC、ring 回绕与磁盘缺段、挂起权限回复、两写者竞争、短写/断连、`execve`/新版启动失败、旧版会话混跑和不兼容回滚。Linux arm64/x86_64 运行原生 fd/信号/退出测试；mac arm64 跑 hc 外层和 48 格功能矩阵。测量冷/热切换和回放时间，记录分布，364 ms 样本提示不要将少数热样本作为延迟保证。

### 规模与主要风险

估计 8–14 个工程日（可并行，OAR 接口可用是前提），含 native holder、协议/发布和 fd 故障测试 2–4 日，TUI 控制器迁移与网格重建 2–3 日，headless transport/post-restart 轮恢复 3–5 日，联调与发布验收 1–2 日。预计 C 产品实现约 350–650 行，TUI/daemon 接线与迁移约 500–900 行，headless 适配及可恢复 RPC 约 700–1,300 行，矩阵和故障测试约 800–1,500 行。建议先验收 TUI，随后用真实 Codex app-server 的已验证路径打通第一个 headless adapter，再接 ACP 和 Claude。

主要不确定性是 OAR 注入接口及各 provider 的有状态 RPC 重附、ring 对长期滚动输出的存储开销、保持 hc raw/输入回复所有权、同 PID 换版早期故障窗口，以及两层升级中的写者抢占。先锁定 wire/manifest schema、日志水位和明确无写/部分写语义，并把 `exec` 成功前后的故障分开测试。Phase A 证据支持原位交接预算，端到端发行条件以矩阵为准。

STATUS: done
