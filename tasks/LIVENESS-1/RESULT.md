# LIVENESS-1

已按任务第 1–10 项修改当前工作树。两份 veteran 答复中的 agy 评分框、Codex 升级及跨目录恢复、Claude 默认拒绝的信任框、agy 向导及公告均有识别用例。

## 会话状态和投递

- `lastProgressAt` 汇总原生记录增长、调用及输出 token 计数、归属会话的 hook、去掉 spinner 和计时噪声的屏幕。只有仍在重绘且其余证据静止超过窗口才报 `silent-hang`。检测到循环轮询或睡眠且模型没有进展时，显示 `waiting-poll` 和累计的零进展时间。
- `quota-wait` 保留 CLI 给出的下次重试时间，直到原生记录确认回合有实际进展。只收到新回合开始或重试动画不会清除状态。登录失败显示 `auth-expired`。高级角色的配额、登录和静默停滞事件按会话和发生时间去重后发桌面通知。整个观测流程使用本地证据，沿用原模型。
- 原生弹窗阻断投递。agy 评分和公告只使用画面可核对的 `0` 和 Escape，写入仍由 holder 检查画面版本及人工输入。其余未获确认的弹窗显示 `awaiting-user` 并升级，Claude 预授权工作区的信任流程仍核对目录和当前选项。
- 原生退出记录退出码和时间并发通知，高级角色通知提供现有 `--handover-from` 接班入口。旧窗格只证明已退回 shell、系统没有保留退出码时，报告退出码不可用。没有自动启动继任者。
- `loom status` 依次显示滞留投递、用户输入或审批、配额和登录、静默停滞、退出，附角色、起始时间和一句原因。轮询耗时另列。

## 无人值守和升级

- Leader、Auditor、Worker 的启动提示和 Loom 技能明确会话无人值守。需裁决时写明事实、选项和建议，调用 `notifications --needs-decision … --kind decision`，先做独立事项并以 `BLOCKED <决定点>` 结束有待决事项的回合。提问工具仅向 Super 开放。
- `loom doctor --prompts` 在隔离 HOME 中启动原生 CLI，模型端点只走回环，验证提问实际缺席或被拒绝、回合仍能完成、实机菜单可识别，并回放原生弹窗用例。Claude 2.1.331、Codex 0.171.0、agy 1.5.17、OpenCode 2.3.0 均通过。升级预检用旧的缓存版本重测 Codex 并发出版本提示，其余三个版本命中缓存。[四款 CLI 的实机日志](/tmp/loom-liveness-prompt-doctor-3.log) · [升级预检及切换日志](/tmp/loom-liveness-upgrade-live.log)
- 升级命令按本次升级 ID 等待终态。超过等待窗口仍切换或状态未确认时返回退出码 `4`，提示查询 `loom upgrade --status`。回归覆盖截止时刻提交和仍处于切换两条路径，隔离项目实测切换为 `committed`。
- 新会话继承 `.project/loomd/bin/loom`，同一路径在切换前后分别调用正在服务的版本，原有参数原样透传。状态面板提示可归属到旧版的 CLI 或 hook。已运行会话中的旧 `LOOM_BIN` 环境值只能通过接班更新。

## 验收

- 普通 `npm test` 390 项通过。使用 Loom 的 macOS 原生 Worker 启动函数和 Seatbelt 配置运行同一套命令，387 项通过、零失败、零取消。macOS 拒绝嵌套 Seatbelt 的三个用例明确显示 `sandbox-limited`，这三个用例在普通全量中通过。沙箱内执行普通权限的 `ps`，保留 PID 身份和泄漏检查，临时制品写入 Worker 允许的目录。[普通全量日志](/tmp/loom-liveness-npm-verified.log) · [Worker 沙箱全量日志](/tmp/loom-liveness-sandbox-verified.log)
- `git diff --check` 通过。实机验证均使用隔离 HOME，未向 pilot-2 窗格写入，未提交。

STATUS: done
