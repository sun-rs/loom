# 付费 CLI 与 iPhone 键盘验收

日期：2026-09-17。承接[批次 A/B 接手收口](2026-09-17-ab-takeover-closure.zh-CN.md)，用户明确授权本轮付费 CLI 验收。所有调用使用临时状态、独立工作目录与测试端口，没有在正式 Room 发消息或调用正式 Agent。

## 当前结果

| 验收项                     | 实际绑定与推理级别                   | 结果                                 |
| -------------------------- | ------------------------------------ | ------------------------------------ |
| Claude Code                | `sonnet` / `low`                     | 联合门禁通过                         |
| Kimi CLI                   | `kimi-code/k3` / `high`              | 联合门禁通过                         |
| OpenCode                   | `deepseek/deepseek-v4-flash` / `low` | 联合门禁通过；本次当选任务负责人     |
| Codex                      | `gpt-5.6-luna` / `low`               | 未通过：CLI 未登录，真实调用返回 401 |
| iPhone standalone PWA 键盘 | 实际用户设备                         | 未执行：Mac 尚未检测到连接的 iPhone  |

三项通过不代表四 Provider 联合门禁通过，也不代表每个 Provider 分别完成了完整任务流程。没有切换模型、降低推理级别或使用 Fake Provider 替代失败项。

## 真实 CLI 证据

执行通过的命令：

```sh
RAH_REAL_MULTI_CLI_GATE=1 RAH_REAL_CLI_NAMES=claude,kimi,opencode RAH_REAL_GATE_KEEP=1 node --test packages/daemon/test/real-multi-cli-gate.test.ts
```

结果：1 项通过、0 失败、0 skip，约 181 秒。断言覆盖：

- 三个 Provider 分别产生一次 canonical 普通回复，普通问答不创建 Task。
- 显式持久任务只有一个负责人，Task 到达 `submitted`，对应 Activation 完成。
- 负责人在自己的 Agent 执行目录写出真实文件，内容为 `RAH OS real Task intent gate`。
- 任务进度与提交两条回复均属于负责人及对应 Thread，没有竞争性的顶层答案。
- RunAttempt 使用授权的实际模型绑定与推理级别，不能以进程成功替代 Room 履约。

完成后只读核验临时数据库：11 个 RunAttempt 均 `exited` / exit code 0；11 个 RuntimeProcess 均 `terminated`；Host 已正常 `offline`。本次负责人为 OpenCode。

本机证据：

- 通过日志：`/tmp/rah-paid-three-cli-20260917.log`。
- 保留的测试状态：`$TMPDIR/rah-real-multi-cli-K8P6H7/state/room.db`，任务文件在该状态目录内的负责人执行工作区。
- 初次四 Provider 尝试：`$TMPDIR/rah-real-multi-cli-O3xT1O`，日志 `/tmp/rah-paid-cli-20260917.log`。Codex 连续失败后隔离，其他三个 Provider 已回复；确认所有临时 RuntimeProcess 终止后结束该测试，不能记为通过。
- Codex 独立认证复核：`codex login status` 返回 `Not logged in`；以相同授权模型和 `low` 运行最小提示，WebSocket 与 HTTP 均返回缺少认证的 401。脱敏诊断来源为 `$TMPDIR/rah-codex-auth-probe-DzkPzw/result.log`。

临时目录包含本机测试数据，仅作本机证据，不作为可分发制品。用户完成 `codex login` 后可只补跑 `RAH_REAL_CLI_NAMES=codex`；本轮未擅自读取其他应用凭据或重配 Provider 账号。

## 门禁前置条件修正

Owner 为 `packages/daemon/test/real-multi-cli-gate.test.ts`，不修改产品业务路径：

1. 启动后等待 Host 实际发布可用 RuntimeOffer，避免目录已可读、Offer 尚未就绪时配置 Agent。修正前复现 404 RuntimeOffer not found。
2. 默认 `#all` 按现行协议自动包含 Agent，改为从真实成员 API 断言这一事实。旧门禁重复手工 onboard，修正前复现 409。前两次前置条件失败均没有启动付费 RunAttempt。
3. 用已有 `agentExecutionWorkspacePath` owner 找负责人实际 cwd；不再到早期共享 cwd 查文件。保留真实文件内容断言。
4. 普通回复阶段发现 `quarantined` 立即报错，避免确定失败后仍等待整个十分钟超时。

原有消息数量、Task 数量、模型、退出码、Thread 归属与实际文件断言均保留。`npx tsc --noEmit`、`npm run check`、`npm run format:check` 与 `git diff --check` 均通过。完整检查共 2292 项：2275 通过、17 项 opt-in skip、0 失败；日志 `/tmp/rah-real-acceptance-check.log`。默认检查中的 skip 不算真实 CLI 通过，真实调用结果单独以上述付费门禁为准。

## iPhone 实机条件与验收范围

`xcrun devicectl list devices` 多次返回 `No devices found`；`xcrun xctrace list devices` 只有 Mac；USB 设备清单也未发现 iPhone。已请求用户连接、解锁并信任此 Mac，开启 Safari 网页检查器并打开已安装的 RAH PWA。未收到设备连接确认，不能据此宣称键盘正确或错误。

连接后按 [R9 实机步骤](2026-09-16-r9-error-boundary-and-ios-keyboard.zh-CN.md#ios-键盘待实机验收)逐项检查 Room、DM、Thread 与搜索输入：键盘弹出、输入、收起、横竖屏旋转、逐层返回。记录 visual viewport 与 composer 的实际边界，确认标题固定、composer 不遮挡、中间内容可滚动、收起后阅读位置恢复、旋转无留白且返回后 viewport offset 归零。桌面 WebKit 或手机尺寸模拟不替代这项结论。

## 正式工作台与交付边界

本轮只更新门禁测试与验收记录，没有更改生产源码或冻结资产；未重启或打断正式工作台。正式 health 仍为 `online`，buildId `d00b5f8de6c8d53b`，与前一轮部署一致。未提交、推送或签发新版本。
