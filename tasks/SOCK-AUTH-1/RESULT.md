# SOCK-AUTH-1 验收记录

loomd 从已授权的能力凭证或升级前存量会话的内核对端身份查找调用者。凭证包含会话地址和 256 位随机值，服务端按项目校验，再从当前受管会话记录读取角色。已退出、正在停止、尚未完成交接的会话没有角色权限。loomd 忽略请求 JSON 的 `caller`。`LOOM_ADDR` 和 hc 地址仅用于普通寻址。发信人和子会话归属都以认证结果为准。

凭证保存在 `${XDG_STATE_HOME:-$HOME/.local/state}/loom/socket-auth/<项目路径的 SHA-256>/`，项目目录权限为 `0700`，凭证文件为 `0600`。loomd 拒绝将凭证放在项目目录或 Git 工作树内。托管会话从启动环境取得 `LOOM_CAPABILITY`。TUI 的进程包装器在窗格内读取凭证，hc 命令参数只带文件路径。外部 Super 在本机操作终端设置 `LOOM_EXTERNAL_SUPER=1`，CLI 读取该项目的 Super 凭证。带有托管身份环境的 CLI 调用只使用会话凭证。

继任者在启动时取得独立凭证，完成交接后启用角色权限。前任在接任后失去权限，退出时删除凭证文件。热升级和失败恢复继续使用同一个外部状态目录。升级目标必须声明支持凭证校验，回滚也遵守同一条件。持有同一操作系统账户的进程仍可访问该账户有权读取的文件。

## 补充验收：旧会话保持原权限

- 仅接管时已在运行、且尚未取得能力凭证的托管会话可走此路径。辅助程序从 daemon 已接受的 Unix socket 获取同 UID 对端。在 macOS 校验 `LOCAL_PEERPID` 与 `LOCAL_PEERTOKEN`，用审计令牌核验 PID 代际。Linux 路径使用 `SO_PEERCRED` 和 `SO_PEERPIDFD`。助手沿同 UID 的进程父链走访并复核出生标识和父子关系，返回 PID 与启动时间。 [Apple libproc](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h) · [Linux socket 选项](https://github.com/torvalds/linux/blob/master/include/uapi/asm-generic/socket.h)
- loomd 将父链匹配到本项目的活会话和已记录的宿主出生时间。管道 holder 及有子进程记录的 TUI holder 也要求来路经过其子进程。旧 hc 记录使用窗格创建时间与复核归属，首次确认后固定精确的内核出生标识。凭证字段显式无效、对端进程无关、出生标识不一致、会话已停止或归属含糊时均无法取得角色。
- 存量会话在原进程寿命内持续用内核身份认证。原 `LOOM_BIN` 可继续工作。外部 Super 和新启动的会话使用能力凭证。无法取得内核证据的候选版本会在存量接管检查中报告阻塞。

## 项目 socket 命令

| RPC | 允许的调用者及限制 |
| --- | --- |
| `hello`、`daemon-status`、`upgrade-status`、`board`、`status`、`ls`、`state` | 含无凭证本地调用。用于查询。 |
| `notifications` 默认查看或查看历史 | 含无凭证本地调用。 |
| `send` | 无凭证调用可发送不署名、无批次的普通排队消息，Auditor 拒收此类投递。托管调用只能以自身身份发信。外部 Super 可用 `--from super` 获取回执。Leader 可创建其到 Worker 的续作批次。Leader、Auditor 和 Super 可用 `steer` 或 `interrupt`，仍须满足目标会话的投递条件。 |
| `spawn` | Super 可启动常驻角色和 Worker。Leader 可启动自己的 Worker，并监督同项目 Auditor 换班。 |
| `rotate` | 当前 Leader、Auditor 可换自己的班。Super 可选目标并覆盖运行配置。 |
| `handover` | Super 可执行交接。Leader 可交接自己或本项目的 Auditor。 |
| `stop` | Super 可关闭托管会话。Leader 可关闭自己或自己管辖的 Worker。 |
| `gate-pack` | Leader 或 Super。 |
| `escalate` | Leader，且必须提供允许的红色升级原因和证据。 |
| `notifications --gate-complete` | Leader 或 Super。 |
| `notifications --take` | Super。 |
| `notifications --complete`、`--needs-decision` | Leader、Auditor 或 Super。`--audit-escalation` 仅限 Auditor。 |
| `senior-override` | 当前 Leader 或 Auditor，仍须通过已有工具复核。 |
| `daemon-stop`、`upgrade-plan`、`upgrade-apply`、`upgrade-holder`、`layout-up`、`layout-adopt`、`switch` | Super。 |
| `approve`、`memory-approve`、`memory-write` 及其他未知命令 | 当前 main 的记忆写入及提案审查是进程内接口。loomd 未暴露这些 RPC，直接请求返回 `invalid-arguments`。`send --from AUDITOR` 同样无法伪造 Auditor 的批准送达。 |

## CLI 入口

| CLI | 行为 |
| --- | --- |
| `status`、`ls`、`state`、`tui`、`layout get`、`daemon status`、`upgrade --status`、`notifications` 的查看选项 | 走查询 RPC 或读取本地状态。 |
| `hist`、`cost`、`memory search`、`handover` 不带 `--to` | 本地读取。`hist` 仍可用本地地址提示缩小目标范围。 |
| `send`、`spawn`、`rotate`、`handover --to`、`stop`、`gate pack`、`escalate`、`notifications` 的写选项、`senior-tool` | 按相应 RPC 授权。`send --wait` 通过本地回执等待一次答复。 |
| `up`、`layout adopt`、`switch`、`daemon stop`、`upgrade` 检查、应用、回滚、holder 相关操作 | 变更及检查 RPC 需要 Super。`up` 可在请求布局前启动 daemon。 |
| `daemon start`、`loomd --project`、`loomd` 的自检及交接启动参数 | 本机进程入口。交接继续校验升级状态和启动进程身份。 |
| `super --terminal`、`doctor` 各选项 | 本机 Herdr 布局和项目巡检入口。`doctor --fix` 在项目写入者退出后按已有归属检查清理。`doctor --prompts` 运行隔离探针并缓存结果。二者无 socket 角色授权。 |
| `--help` 和命令帮助 | 本地输出。 |

## 验证

- 真实项目 socket 加隔离的 OAR 运行时夹具覆盖假 `caller`、无效凭证、低权限凭证、伪造批准发信人、门禁、升级和未知记忆写命令。用启动环境中的凭证调用托管 CLI，确认 Leader 与 Auditor 可登记决定、Worker 被拒。验证凭证权限、跨项目拒绝和停止后撤销。
- Leader 和 Auditor 自助换班回归验证继任凭证独立、确认交接前不能使用角色权限以及前任退出后原凭证失效。TUI 夹具确认能力值进入原生进程环境，未出现在 hc 参数中。
- 使用真实 loomd 进程与 Codex 管道 holder 的隔离夹具，验证升级失败恢复和成功热升级后，原会话和外部 Super 的原凭证仍有效。缺少凭证协议声明的升级目标在预检被拒绝。
- 从 `323a3eb7` 解出的原始发布树启动旧 OAR 会话，热升级后 Leader、Auditor、Worker 的原 PID 和会话身份都保留，原 CLI 可登记门禁和通知。启用旧发布树的专项测试 2 通过，覆盖 OAR 迁移及 macOS 的 TUI 对端父链、出生标识和撤销。Linux 路径未在本机执行。
- 在 `infra/sock-auth` 独立工作树运行 `npm ci`，安装成功。全量 `npm test` 在隔离的 `HOME` 中通过，721 通过、0 失败、0 跳过。`git diff --check` 通过。变更保留在该工作树，未暂存、未提交。

STATUS: done
