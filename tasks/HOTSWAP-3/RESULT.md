# HOTSWAP-3 Phase B · TUI

新建受管 TUI 默认使用 v3 holder。原生 holder 独立持有内层 PTY，loomd 持有 xterm 网格、界面识别、草稿与投递策略及原生证据。macOS arm64 的 24 格实机矩阵全部通过。Headless 仍按原有 session-host/OAR 路径运行。改动留在工作树供 Super 复核。[Phase A 设计](../HOTSWAP-2/RESULT.md) · [实机矩阵运行器](/Users/sun/Code/exp-relay/hotswap-3/matrix.mjs)

## 实现

- C holder 使用 `forkpty` 与非阻塞 `poll`。从出生开始留存有序输出和 resize 事件，使用 64 位序号及字节偏移、分段日志与短环形缓存。单次 syscall 的外层镜像进度单独计数。日志 I/O 故障或超过每会话 256 MiB 时，网格读取显式报 `gap`，自动写暂停。控制端用私有目录和 socket、Unix peer UID、incarnation 与控制者世代校验。 [C 实现](../../holder/holder.c) · [wire 接口](../../holder/protocol.mjs)
- loomd 从偏移 0 重放到水位，校验 hc 地址／PID／创建时间、原生子 PID 和 native session ID。原有 `bindTuiSession`、草稿验证、overlay／信任对话框、提交确认及账本在 v3 由 loomd 调用。自动写设 800 ms，人类字节计数、输出偏移和事件水位由 holder 在 syscall 前作最后一次比较。短写保留已写前缀，后续自动 Enter 需要新的帧及原生证据。OpenCode 实机暴露的逻辑行右侧填充已加入草稿回归覆盖。 [网格和 CAS](../../tui/holder-terminal.mjs) · [控制与接管](../../daemon/tui-holder.mjs) · [草稿回归](../../tui/agy-draft.test.mjs)
- `loom upgrade --to RELEASE` 切换 loomd。`loom upgrade --holder SESSION --to RELEASE` 针对原 holder PID 安装候选映像，可加 `--check`。`loom upgrade --rollback` 与 `loom upgrade --holder SESSION --rollback` 各自回切上一版本。同 PID 切换校验候选 manifest、SHA-256、目标架构和自检。只继承白名单 fd，在新映像恢复事件循环并核对 READY 后提交 holder 版本。 [命令](../../cli/upgrade.mjs) · [候选校验](../../holder/assets.mjs) · [release 自检与阻挡](../../daemon/upgrade.mjs)
- 已绑定的 v0/v1/v2 Node wrapper 留在原窗格与原发布根，legacy wrapper 源码仍可用。新 release 的自检同时发布旧控制默认协议、v0–v3 兼容列表、v3 新会话默认协议及覆盖原生二进制字节的完整 `releaseDigest`。真实 Codex 从基线 `4fff8611` 升级后，v1 和 v3 同时活跃，旧窗格身份与后续投递持续。回滚预检仅由活跃 v3 会话挡住。 [兼容性原始记录](/Users/sun/Code/exp-relay/hotswap-3/r-wEa3EY/codex/steps.jsonl) · [摘要](/Users/sun/Code/exp-relay/hotswap-3/r-wEa3EY/summary.json)

## 实机矩阵

macOS arm64，hc 0.1.22。每个 provider 使用独立 HOME、临时项目及 hc core，按绝对路径执行原生 CLI，模型请求使用 loopback。候选 holder 有不同的二进制摘要。每格验证原生 session ID、CLI PID、hc 地址／PID／创建时间保持，唯一投递标记的原生确认均恰好一次，人工输入为 0。busy 在 mock 已收到该轮唯一标记且原生记录确认后切换。表中时间为 mock 收到请求至切换后的身份核验完成，均处于 9 秒延迟内。回滚格回切 daemon 和 holder 两层。[Codex、Claude、agy 原始摘要](/Users/sun/Code/exp-relay/hotswap-3/r-yw3mvP/summary.json) · [OpenCode 原始摘要](/Users/sun/Code/exp-relay/hotswap-3/r-FdbWVf/summary.json)

| CLI | idle loomd 升级 | idle holder 换版 | idle 回滚 | busy loomd 升级 | busy holder 换版 | busy 回滚 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Claude | 通过 | 通过 | 通过 | 通过 1,358 ms | 通过 698 ms | 通过 1,934 ms |
| Codex | 通过 | 通过 | 通过 | 通过 1,691 ms | 通过 684 ms | 通过 2,891 ms |
| agy | 通过 | 通过 | 通过 | 通过 1,258 ms | 通过 583 ms | 通过 1,923 ms |
| OpenCode | 通过 | 通过 | 通过 | 通过 3,065 ms | 通过 1,889 ms | 通过 3,454 ms |

每个 CLI 从首轮到最后一格共有 10 个唯一投递。按列顺序，切换前已完成确认数为 1、2、3、4、6、8，切换后检查新增 1、1、1、2、2、2 个确认。busy 的新增确认包含切换时原轮与换版后的新输入。逐格的 ID、原生回执计数、PID 和延时均在步骤日志中。[Claude](/Users/sun/Code/exp-relay/hotswap-3/r-yw3mvP/claude/steps.jsonl) · [Codex](/Users/sun/Code/exp-relay/hotswap-3/r-yw3mvP/codex/steps.jsonl) · [agy](/Users/sun/Code/exp-relay/hotswap-3/r-yw3mvP/agy/steps.jsonl) · [OpenCode](/Users/sun/Code/exp-relay/hotswap-3/r-FdbWVf/opencode/steps.jsonl)

## 故障与构建验证

- `npm test` 为 **302/302**。新增 5 个测试覆盖分帧和畸形帧、写前的人类输入竞争、800 ms 界线、短写及 EAGAIN、旧世代 fencing、重复写去重、日志缺段、manifest 与二进制权限／字节以及切换失败。基线曾有一例并发测试把临时证据目录纳入发布摘要后读到消失的文件，本次摘要遍历过滤了这类目录。 [完整测试日志](/Users/sun/Code/exp-relay/hotswap-3/npm-test.log) · [定向测试日志](/Users/sun/Code/exp-relay/hotswap-3/focused-tests.log)
- 实际 hc 窗格内，键入后的 211.788 ms 在新 holder 上仍返回 `busy-human`，超过 800 ms 后同类写入才生效。三字节字符 `─` 在 `e294` 后换版，尺寸改至 99×33，再收到 `80`，重放和 hc 都显示 `─ LIVE-UTF8`。备用屏幕、原生子 PID 和窗格保持，程序自行退出 42。 [探针与偏移](/Users/sun/Code/exp-relay/hotswap-3/t-1x3btF/result.json)
- 在 Codex 的 mock 活跃轮杀掉该测试的 loomd 并从同一 release 重启，799 ms 内以控制者世代 2 重新认领原 holder。hc 和原生身份保持，首轮、在途轮和重启后的新轮各原生确认一次。 [daemon 重启证据](/Users/sun/Code/exp-relay/hotswap-3/r-jOFn02/summary.json)
- `execve` 返回 `ENOEXEC` 时旧映像继续服务，世代保持，随后同一 holder 可再次换版。通过自检但换入后退出 99 的候选由实际 `loom upgrade --holder` 报 `candidate did not become READY`，hc 将该会话报告为已结束。holder 被 `SIGKILL` 或新映像在恢复 fd 前崩溃时，唯一 PTY 丢失属于显式失败。 [原生故障测试](../../holder/holder.test.mjs) · [实际 CLI 故障日志](/Users/sun/Code/exp-relay/hotswap-3/r-bk2kfU/codex/steps.jsonl)
- 发布清单包括 macOS arm64 Mach-O（37,528 B）、Linux arm64 静态 musl ELF（58,992 B）和 Linux x86_64 静态 musl ELF（51,936 B）。macOS 由 Apple Clang 原生构建。Linux 使用校验官方 SHA-256 的 Zig 0.15.2 压缩包解出的编译器和 libc。本机没有 Docker 或 Podman，Linux 仅验证交叉构建与产物格式。 [构建脚本](../../holder/build.mjs) · [产物摘要](../../holder/bin/manifest)

## 变更规模与风险

新增原生 C/头文件 843 行，新增 Node 端传输、资产构建和控制器 496 行，新增独立测试 218 行。已有文件改动 171 行新增、50 行删除，含 OpenCode 回归测试。旧 wrapper 内的实现保留，v3 将业务调用点切到 loomd 并复用共享模块。

长会话目前依赖全量出生重放与有限日志，磁盘上限触发后的自动控制需要有效的历史才能恢复。持久化的部分写属于待对账状态。候选换入后到 READY 的故障窗口由失败回执覆盖，独立 fd 保活未纳入本卡。OpenCode 有一次并发探测在 standalone server READY 前退出，原因未确定，独立重跑的六格均通过。 [该次探测](/Users/sun/Code/exp-relay/hotswap-3/r-7oeHZj/opencode/steps.jsonl)

STATUS: done
