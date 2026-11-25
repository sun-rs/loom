# HEADLESS-UNIFY-1 结果

基线包含 PILOT2-TOOLS-1 提交 `9e1096ac` 和本卡增补 `055151d3`。改动留在工作树供 Super 审查。

## 桌面通知

先完成 item 0。测试环境与隔离运行器关闭桌面路由。直接通过 Node 的测试运行器执行也会屏蔽 osascript，回归明确断言系统命令不会调用。真实项目的桌面提示限于裁决请求、项目完成、审计升级和 Leader 异常退出。每项目五分钟最多一条，合并与间隔在账本中持久化。其他事件仍可从 `loom notifications` 查看。

## OAR 路径与兼容

新建无头会话统一使用 OAR 0.130.1 detached session-host。已登记为 `holder-pipes` 的 Codex 会话依原记录接回和关闭。保留 pipe 实现及未公开的测试开关 `LOOM_TEST_CODEX_PIPES=1`，用于验证已有宿主继续运行和升级回退。

- OAR 自身的 Codex app-server 请求等待原生 RPC 回应。宿主增加 10 秒控制确认期限。超时对外显示 `stuck/request-timeout`，投递保持不明，迟到的原生回执仍可结算，同一请求禁止重发。[OAR app-server client](../../node_modules/@botiverse/oar/dist/runtimes/codex/app-server-client.js)
- 关闭先给 OAR dispose 四秒。随后对仍属于本宿主的进程发 SIGTERM，800 毫秒后只对复核仍存活的进程发 SIGKILL。回归用忽略 SIGTERM 的独立子进程验证了两级信号。OAR ACP 自身已经管理原生会话与 terminal handle 的清理。[OAR ACP cleanup](../../node_modules/@botiverse/oar/dist/shared/acp/shared-session.js)
- 输入在记录摘要和进入 OAR 前调用 `toWellFormed()`。Codex 的确定拒绝从 OAR `response.body.native` 读取原生错误，复用已有的转向降级与中断状态判定。背景任务清理启用 OAR 的 `endTurnProcessesOnAbort`，由 OAR 按进程归属和原生轮次执行。[OAR control contract](../../node_modules/@botiverse/oar/dist/contracts/control.d.ts) · [OAR Codex abort cleanup](../../node_modules/@botiverse/oar/dist/runtimes/codex/turn-processes.js)
- Claude 账单回归覆盖默认订阅和显式 API 授权。无头路径默认移除两个 Anthropic API 环境变量，只有明确授权时保留，两个路径均不传 `--bare`。实验使用隔离的 loopback 测试值。

## 宿主职责

宿主只负责原生进程启动和归属、私有 socket 和代际控制权、控制调用的串行化与去重、请求和原生事件日志、转录文件定位接口、轮边界 Git 快照，以及退出和进程组清理。回执只保留控制结果、请求 ID 和序号。原生转录回退查找、OpenCode 只读导出核对、Git 差异与证据分类移到 loomd 及历史读取层。已记录的工作树、合入目标和证据设置支撑 daemon 离线期间的轮边界。

Worker 线及新增特殊 worker 的 OAR 约束已写入 [HEADLESS.md](../../docs/HEADLESS.md) 和仓库中的 loom 说明。Worker 宿主在下次派工采用新版本，长期 TUI 仍由 holder v3 托管。

## 隔离实测

分别用原生 Codex 0.171.0、agy 1.5.17、Claude 2.1.331 和 OpenCode 2.3.0 启动四个真实 OAR worker。OpenCode 使用 `deepseek/deepseek-flash` 指向本地 mock。四个 worker 均有项目证据卡和同结构的 `loom hist`，原生回复完整。存在 ACP 文本片段但缺少独立轮末正文的情况仍标为待证。OpenCode 用绑定会话的原生导出核对正文，agy 和 Codex 以绑定转录核对。

让四个第二轮同时在本地端点等待，执行 `loom upgrade` 后再释放。四个宿主 PID、原生进程身份、原生会话和 OAR 事件流均保持一致。两轮共八条输入，每条恰有一条原生收件、一条轮末和一份确认正文。无人工输入。OpenCode 首轮在 mock 上有两次模型请求，该输入的原生收件仍为一次。实验结束后逐一核对了宿主和原生进程均已退出。[四路升级证据](</Users/sun/Code/exp-relay/headless-unify-1/r-k5DZu1/result.json>)

Claude 2.1.331 在同一隔离工作树的原生 `--resume` 选择器中同时显示 `loom` 标记的 TUI 和 OAR 无头会话。TUI 探针用 Loom 的 Claude 启动参数和显式 `loom` 测试环境。现有托管 TUI 继续清理继承的 entrypoint，OAR 继续显式使用 `loom`。`--continue` 在普通和 `loom` 启动环境均选择最近的 OAR 会话。用 TUI `--resume <id>` 与 OAR 原生 `resume` 对两种会话逐一验证，四次均保留原会话 ID 并产出回复。[Claude 续接证据](</Users/sun/Code/exp-relay/headless-unify-1/r-to3c34/claude-resume.json>)

## 成本视图

`loom cost` 保留各角色的原始 token 和原始占比，增加按 CLI 价表后的估计美元成本及估计占比。四类 token 分别计价，项目可通过 `cost.prices` 覆盖参考价格。这是基于已记录用量的估算。[参考价表](../../docs/HEADLESS.md#用量估算)

## 回归

`npm test` 通过 344 项，失败 0 项，跳过 0 项。`git diff --check` 通过。

STATUS: done
