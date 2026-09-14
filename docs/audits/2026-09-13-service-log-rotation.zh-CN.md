# 服务日志轮转与现有能力澄清

## 现有能力

用户指出 Guide、升级核验及登录恢复表述容易被理解成缺少整个功能。核对后明确：

- Settings 的 Codex / Claude Guide 已默认开启（`RuntimeGuideSettings` 默认 enabled），通过既有 native runtime transport 投递忙时通知。Claude 的 `attachClaudeBusyInput` 使用原生 stream-json user frame，但会等待 tool boundary、避开 compacting，并要求 resume readiness。Raft 1.0.31 的区别是 direct/steer 条件变化；本批不改投递策略或开关。
- `ComputerUpgradeCoordinatorRunner`、K carrier 与 successor-ready 确認代码已经存在。它们是后台升级编排，不是新增加的页面或常驻“协调器服务”。文件版本/摘要校验只是其中一部分，还涉及旧进程退出、实际运行实例/代际与最终结果核验。现有源码工作台重启另外由 `scripts/restart-local-workbench.mjs` 的准确 PID、状态备份、空闲检查、冻结 Web 构建与退出检查负责；不能把两条启动方式混为同一个已部署功能。
- macOS 登录恢复指用户登录操作系统时由 LaunchAgent 的 `RunAtLoad` / `KeepAlive` 启动后台，与 RAH 网站账号登录无关。仓库已有 Core / Computer 的 LaunchAgent 生成及安装代码；代码存在不意味着当前用户已经启用该服务，本批不自动安装。只读检查本机旧 `com.rah.workbench` plist：`RunAtLoad=false`、`KeepAlive=false`，不将这个旧文件当作登录自启已启用的证据。

## 上游来源与边界

Raft Computer 1.0.31 官方发布物及摘要见[版本研究](./2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)。主 bundle SHA256 为 `d971d8f23b3178b008ce409964082f1dacb1d638a8965f11d19fef274331aeca`；静态切片 `packages/computer/src/logRotation.ts` 与 `service.ts`（调用 `rotateLogIfNeeded` 后再 open/spawn）。版本来源为 https://cdn.raft.build/computer/1.0.31/raft-computer-darwin-arm64.gz。

采用 UTC 日期、超过 64MiB 阈值、跨日轮转、同日递增编号与 14 天保留算法。它是**进程启动前检查**，不是运行中每次写入的硬上限；不声称进程连续运行时日志绝不超过 64MiB。Multica 仓库的 daemon manager / 日志相关实现没有提供更适合本次启动前轮转的可复用 owner，因此采用用户指定的 Raft 来源。

这是带来源说明的结构移植，不是字节复制：发布 bundle 保持分析用途、未引入产品依赖，也不假定未提供的开源再分发许可。RAH 改动包括类型化结果、不跟随日志符号链接、以排他 link/unlink 发布归档而非可能覆盖目标的 rename、归档名耗尽及文件系统错误明确失败。清理仅匹配同一日志基名的日期归档，不删除其他文件；轮转不触及 Room 数据或 Agent 私有记忆。

## 单一 owner 与接线

`packages/agent-host/src/service-log-rotation.ts` 是唯一算法 owner：`rotateLogIfNeeded`、`rotateServiceLogs`、`openServiceLogs`。

- 正式源码工作台重启：旧进程确认退出后，轮转 `~/.rah/logs/core.stdout.log` / `core.stderr.log`，新进程继承新打开的文件句柄，父进程关闭自己的副本。RAH 自定义数据根对应相同的 `logs` 子目录；此前外部重定向的 /tmp 日志不擅自移动或删除。
- 显式 Core / Computer LaunchAgent activation：如旧服务存在且要求替换，先 bootout 并确认注销，之后轮转，最后 bootstrap。已经加载且无需替换时完全不动活动日志。
- 不修改单次 CLI 的终端输出、不轮转 Provider 自有诊断/会话文件，不拦截进程 stdout.write。运行中的 UI 服务重启（同一个 OS 进程）、launchctl kickstart、macOS 自动登录启动不额外添加对活动文件的轮转；这避免旧 FD 持续写入已经归档的文件。若需要连续运行期间严格限制大小，需要由写入 owner 统一关闭/重开文件，属于单独增强。

## 验证

测试先失败，再实现：默认 64MiB 的稀疏文件边界、同日重复归档保留旧内容、UTC 跨日、14 天边界及编号归档清理、符号链接拒绝、真实无 Provider 子进程继承新 FD 后只向新日志写入。Core / Computer 的 fake launchctl 测试验证“已加载不动日志”和“退出后、bootstrap 前轮转”的顺序。

最终 `npm run check`、`npm run format:check`、`git diff --check` 与 `npm run build:web:workbench` 通过。正式实例经 idle 检查、持久状态备份及精确进程的优雅停止后重启；新进程 FD 1/2 分别指向 `~/.rah/logs/core.stdout.log` / `core.stderr.log`，两文件权限均为 0600。验证的冻结构建为 `d32111b686ea5dd6ccc696c6a3cf1ab4c488ee75a9b17e3f2530c8042b5ec5be`。

全新真实 Chromium 页面通过本机回环、本机 LAN 与 Tailnet 地址读取现有四个 Agent，打开运行时配置，并进入频道消息输入区域；无页面异常，也未提交业务修改。Settings 检查显式等待异步卡片加载后通过；检查了桌面及 390×844 布局。此证据来自 Mac 浏览器，不等于 iPhone 移动网络可达性验收。未运行付费 CLI，未变更 Claude 投递策略、登录要求或升级流程。

全量检查中的既有图标冻结测试发现新增 git-branch 未作独立排除；对照发布源码 I6e/Ec 及 SHA256 验证其路径/圆几何后，增加独立精确断言并从旧字节哈希中仅移除此完整新增块。保留旧哈希常量，未修改 sprite 或放宽旧图标校验。
