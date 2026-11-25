# ORCA-EVAL-0：Orca 作为平台、零件库和上游的深度评估（只读研究）

## 背景
loom_new 决定以"全 TUI 模式"作为底层：所有 CLI 都以 TUI 形式运行在 PTY holder（hc）中，结构化信息来自各家的 hooks 和本地会话文件；Codex 和 OpenCode 可以额外通过 app-server 或 serve 投递。这套模式 Orca 已经验证过，所以 Orca 的地位大幅上升。用户想知道：能不能站在 Orca 的肩膀上，在 CLI 升级时跟着 Orca 的更新"搭便车"，甚至把整个工作流都迁到 Orca 上。

loom 的目标架构：一个 super 始终与用户对话；多个项目，每个项目有 leader、auditor 和 worker 1..N。任何角色可以运行任何 CLI、模型和推理档位，可以跑在任何机器或容器上。支持多 provider、多账号，出口 IP 稳定。daemon 负责转发角色的原生最终回复，角色不需要调用任何工具；自动化角色不走审批，也不弹选择器。

## 资料
- 固定版本源码（commit b7fd7caa3，2026-11-23）：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/orca/`。重点目录：`README.md`、`docs/`、`docs/site/content/docs/`、`src/main/bots`、`src/main/automations`、`src/main/agent-hooks`、`src/main/cli`、`src/main/daemon`、`src/main/*-accounts`、`src/main/antigravity`、`src/main/codex*`、`cloud/`、`mobile/`。
- 已有笔记：`.../AR-1/agy/scratch/notes/orca.md`；`.../arch-research-2026-11-23/REPORT-R2.md`。
- 允许联网查询 orca.dev 文档、GitHub 仓库页面和 release 记录。
- 允许联网调研其他开源项目，例如 coder/agentapi、claude-squad、ccmanager、crystal、agent-deck 等，只读。

## 要回答的问题（每条结论都要标【源码 文件:行号】【文档 URL】【推断】）
1. **onorca / Orca Cloud**：onorca.dev 是什么？哪些功能必须登录 Orca 账号或连接 Orca Cloud？哪些可以纯本地或自托管使用？遥测默认怎么设置？`cloud/` 目录是否开源，许可是什么？
2. **Remote Orca Server**：能否在 Linux 或容器里无界面运行？它托管什么（PTY、agent、worktree）？客户端协议是什么？怎么配对？能否不打开 Electron 界面，完全通过程序控制（`orca` CLI）？
3. **Orca CLI 和 orchestration**：完整列出 CLI 的能力（worktree、启动 worker、发送消息、等待、读取结果、automations）。coordinator 和 worker 之间怎么传递结果？worker 需要调用工具或命令回报吗（之前的研究认为 coordinator 要轮询 `orca orchestration check`）？还是 daemon 会转发最终回复？如果用 Orca 实现 super → 多项目 → leader/auditor/worker，各缺什么？
4. **Plugins**：插件 API 的范围是什么？只管主题、编辑器、语言和面板，还是能扩展 agent、编排或 hooks？
5. **Orca Bots**：架构如何？运行在本地还是云端？是否依赖 Slack、Linear 或 GitHub？记忆机制（`SOUL.md`、`MEMORY.md`）怎么读写、怎么注入？触发器和定时任务怎么工作？它能否充当 loom 的 super，即"始终与用户对话、带记忆、能派活给多个项目"？差距在哪里？
6. **账号能力**：`claude-accounts`、`codex-accounts`、`grok-accounts`、`cursor-accounts`，以及 antigravity 的 native-account：
   - 用量和限额探针（剩余额度、重置时间）从哪里读：官方接口、CLI 的 `/status`、本地文件，还是自己解析 token？
   - 多账号切换的机制：managed homes、改写凭据文件，还是读写 OAuth token？
   - 逐项判断是否碰到我们的红线：读取、刷新或覆写 OAuth token 是红线；伪造 clientInfo 是红线；使用独立的 HOME 或配置目录、让 CLI 自己完成登录，不碰红线。
   - 哪些可以直接复用于 loom 的"每个 Cell 一个账号"模式？
7. **跟随上游的成本**：Orca 最近一个月的提交量（本地约 8280 个）；按 CLI 统计，每家 hook 和 transcript 相关文件在最近 60 天的变更次数（用 `git log --since` 统计 `src/main/<cli>/hook-*`、`agent-hooks/README.md` 矩阵等）；Orca 内部有没有"CLI 版本兼容矩阵"或探针机制。给出一份"上游监视清单"：哪些文件一变，就意味着某家 CLI 的 hooks 或 transcript 格式变了。
8. **其他专门控制 CLI TUI 的库**（类似 OAR，但面向 TUI）：逐个列出机制（屏幕解析、hooks 还是 transcript）、支持哪些 CLI、许可、活跃度，以及能否作为库引入。
9. **总结论**：在下面三条路线里给出推荐和理由：
   - (A) 把 Orca 当平台，loom 只做它缺的部分；
   - (B) 把 Orca 当上游零件库，我们跟着它的变更同步，用监视清单加小型 vendored 模块；
   - (C) 抽取一次后不再跟。

   同时列出每条路线的锁定风险：Lovecast Inc. 是商业公司、产品变化快、有云端依赖。

## 交付
`/Users/sun/Code/repos/loom_new/tasks/ORCA-EVAL-0/RESULT.md`，中文。最后一行写 `STATUS: done`。

## 红线
- 只读研究。只能写 `tasks/ORCA-EVAL-0/` 目录。不要 git commit。
- 不安装、不运行 Orca，不登录任何账号，不配对任何设备。
- 不读、不打印、不复制任何凭据：`~/.codex/auth.json`、`~/.codex/memories*`、`~/.claude*` 凭据和 keychain、`~/.gemini`、`~/.loom-next/provider-homes`、任何 `.env`；不读用户真实的会话记录。
- 不调用付费模型，不使用 `hc send`、`hc keys`、`hc kill`，不修改任何其他仓库。

## 补充问题 10（orchestrator 追加，决定性问题，请优先回答）
Orca 文档写着"Orca wakes the coordinator when a worker reports, asks, or stops"。请从源码确认：
1. worker **没有**执行 `orca orchestration send --type worker_done`，只是正常停下（例如 Stop hook 触发、进入 idle）时，coordinator 收到的唤醒消息里有什么？是否包含 worker 的**原生最终回复正文**（来自 hook payload 的 assistant reply 或 transcript），还是只有一条"已停止"的状态通知？
2. 这个任务是否会因此被标记为完成，还是保持 dispatched，要等 worker_done？
3. 如果要让 Orca 做到"不依赖 worker_done，把原生最终回复直接当作完成结果交给 coordinator"，需要改动多少代码？能否作为插件、配置或外部进程实现，而不改 Orca 本体？
给出 文件:行号。
