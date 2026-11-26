# HARDEN-PS-1 结果

基线为 `50fd8e64`。改动留在 main 工作树，未提交。

## 会话宿主身份

- 恢复时优先握手现有 socket，并核对项目、地址、incarnation、发布版本、原生会话和已登记进程身份。socket 暂不可达时，`ps` 无行和 `kill(pid, 0)` 的 `EPERM` 均保留原宿主，状态显示 `liveness-unknown`。已登记 PID 的 `ESRCH`、启动时间或 UID 不匹配、已绑定的退出记录才用于确认原宿主消失。进程列表变化本身不会删除旧 socket 或创建新宿主。
- 注入只漏掉原宿主的 PID 行，在明确的基线版本首次复连后观察到 incarnation 改变。修复后，socket 可达时原宿主及原收件记录保持不变。临时隐藏 socket 且同时漏行时，状态为 `stuck`，原因是 `liveness-unknown`，绑定仍相同。
- Codex pipe holder 和升级启动器也使用正向死亡证据。缺失的进程表行不推进退出或消耗 pipe 恢复次数。回归覆盖 `EPERM`、`ESRCH`、PID 复用及 socket 连续性。

## 测试隔离与 OpenCode 调查

- `npm test` 通过测试入口分配短路径临时 HOME、XDG 路径和工作目录，固定 PATH，设置 `GIT_CONFIG_GLOBAL=/dev/null` 与 `GIT_CONFIG_NOSYSTEM=1`，清理继承的 CLI、鉴权及 `LOOM_REAL_HC` 配置。测试自己的 Git 配置仍放在它的临时目录。集成测试显式继承受限的 `LOOM_TEST_PS`。
- 子进程守卫核对实际可执行路径，包括 Node 依赖发起的调用和符号链接。提供商 CLI 与 Herdr 依赖用测试目录中的绝对替身路径。基础系统工具、当前 Node 和被测 Loom 二进制有明确允许清单。审计了测试的原生 holder / PTY 调用点，其命令参数均由夹具构造。
- pilot-2 历史阶段运行器的 `exec('opencode', …)` 继承了 PATH。旧的阶段测试中，有的注入 `runStage`，也有调用门禁却未注入它的用例。阶段分支实际进入后可以解析到真 OpenCode。该链路用临时 HOME/XDG、合成 keychain 和上游传输，OpenCode 的唯一配置模型指向回环端点，工具权限为 deny。该配置本身没有给二进制施加系统级出站限制。审阅的验收和证据记录没有记录旧运行解析出的二进制路径或 PID，因此无法确认旧测试是否实际启动了真 OpenCode、访问了真实数据或发起其他网络请求。后续已核对记录的替身日志为空。当前 main 没有该历史阶段模块，测试守卫会在裸 CLI 名称进入 OS 之前拒绝它。

## agy 登录提示

- 将 agy 的完整 `⚠ Sign-in update needed` 提示识别为独立 `auth-warning`。正常回合和投递仍按原生状态运行。通知正文保留原提示，账本按账号指纹去重，画面缺少账号标识时按当前 agy 登录环境去重。
- 同一账号跨会话只报一次，另一账号可独立通知。真实登录选择提示和原生鉴权请求失败仍为 `auth-expired`。旧误报的画面状态也可在确认只剩提示时清除。

## 验证

- 使用生产 worker Seatbelt 启动器和受限的集成 `ps` 桥运行原崩溃矩阵及新增 socket 回归，54 项通过。原崩溃矩阵与新增回归在宿主机也通过。
- 宿主全量首轮 728 项通过，唯一失败是新增 agy 测试用例的屏幕替身缺少 `complete` 和 `how`。补齐后 729 项通过。纳入 IV 忙碌投递补充后，宿主全量 731 项通过，零失败、零跳过。

[基线故障复现](/private/tmp/loom-harden-red.log) · [宿主机全量复跑](/private/tmp/loom-harden-current.log) · [sandbox 与受限 ps](/private/tmp/loom-harden-worker-final.log) · [agy 回归](/private/tmp/loom-harden-auth3.log)

## 忙碌投递 SLA

- pilot-2 两条投递在 122,426 ms 和 159,381 ms 被标为 `waiting-writable`。原生 `fullyIdle: true` Stop 分别只领先告警 611 ms 和 169 ms。之后分别过 1,902 ms 和 1,045 ms 拿到接收回执。旧规则每次只按最新快照取 120 或 360 秒，第一次观察到 Stop 时就把先前忙碌期间积累的等待时间套上 120 秒。
- 观察到原生回合或压缩后，投递持久保留该次忙碌 SLA。Stop 或重启不会把它降回 120 秒。正在等待用户交互仍用短阈值。重放两个实测时间线以及既有 360 秒和正常停滞升级的回归，4 项通过。

[忙碌 SLA 回归](/private/tmp/loom-harden-busy-sla.log) · [含全部补充的宿主全量](/private/tmp/loom-harden-all-addenda.log)

STATUS: done
