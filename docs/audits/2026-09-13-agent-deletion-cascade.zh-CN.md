# Agent 一次确认删除与弹窗规格

## 依据与边界

Raft Web `index-MqTUR4Ez.js`（SHA-256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`），来源 <https://app.raft.build/assets/index-MqTUR4Ez.js>。授权取证文件位于 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`，仅用于分析，不进入产品依赖。沿用[复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)的来源与许可边界，本批是结构适配与 CSS 规格移植，不是服务器源码逐字复制。

- pretty 文件 81189：`deleteAgent` 只调用 `DELETE /agents/:id`，成功后设 deletedAt/inactive 并清除活动投影；没有前端先停用要求。
- 107310：`Ki` 确认框；96510–96620：`an` 小按钮及 `vs` spinner。
- Computer 1.0.31 的 `chunk-5Y2HSDGS.js:33248`：stopAgent 取消排队启动、自动重启、通知计时器，撤销运行凭据，停止 runtime；41163 接收 agent:stop。版本与完整下载哈希见[1.0.31 源码审查](2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)。中央服务器删除实现不可见，不能声称已经证明其服务端 stop/delete 时序或文件清理范围。
- 对照 Multica `server/internal/handler/agent.go:2320` 的 ArchiveAgent：归档身份后取消 pending/active tasks。它不是 Raft 删除实现，也不构成 RAH 删除 Room Task 的依据。

2026-09-20 更新：[任务身份与负责人](2026-09-20-deleted-agent-task-identity.zh-CN.md)替代下方旧任务释放规则：所有状态解除负责人，保持原任务状态，启动补齐旧 tombstone。

## 本地行为

唯一 durable owner 是 Kernel `agent-deletion.ts`，沿用 `/agents/manage` 的 tombstoned 命令。一次用户确认生成 `agent.deletion_requested`，先通过原认证、manager、freshness 和幂等校验，持久停用 Agent。HTTP 断开、30 秒等待超时均不会撤销请求。Daemon 每秒调用同一 Kernel 完成器，启动时也恢复未完成请求；重复打开弹窗可加入已有删除请求，无第二队列或另一个身份状态模型。

请求提交后禁止配置/重新启用，并在 Worker 授权和每次使用时拒绝旧运行回写。停止与真实终止回执仍由既有 AgentHost/supervisor 完成。尚有 leased Activation、非终态 RunAttempt、未证明终止的 runtime、未释放 placement 或排他操作时，删除保持等待；时间流逝不是退出证明。

证明安全后，在同一事务内：

- 取消 queued/quarantined Activations，保留原 Inbox 的未读事实，不声称已读或任务完成。
- 解除未完成 Task 的该 Agent 负责/认领关系；普通未完成任务回到 todo，in_review 保留审核状态。其他协作者、讨论、提交和已完成任务历史保留。这是 RAH 的显式适配，不冒称 Raft 中央服务器原样行为。
- 取消失去有效 Agent 的待答输入，终止涉及该 Agent 的未完成重分配操作，避免旧操作把已删除 Agent 再指派回来。
- 取消该 Agent 的提醒，并作废待投递提醒回执，记录 reminder cancellation log。
- 移除全部 Room 成员关系和 Host 凭据中的 Agent 授权，写入最终 agent.tombstoned 与 Outbox。

归档 Room 的普通内容写入仍被拒绝。只有携带真实持久删除请求、actor 匹配、且属于列明的清理事件类型，才能写入生命周期清理事件。此例外不是开放 archived Room 写入口。

不删除 Room 历史、项目目录、Agent 私有记忆或 provider 本地文件；删除身份与完整工作区重置是不同操作。弹窗因此保留准确的本地文案“这会移除 Agent 身份及关联权限，且无法撤销”，不声称删除所有历史字节。

## UI 规格

Chrome Raft 实测视口 1098×1172、DPR 2。只打开并取消 Alice 删除框，没有删除真实 Agent。

| 参数        | Raft 与本地规则                                                     |
| ----------- | ------------------------------------------------------------------- |
| 宽度        | 384px；390px 视口下本地 358px                                       |
| 边框 / 阴影 | 2px 黑边 / 4px 墨色阴影（本批修复原 6px）                           |
| 内边距      | 24px                                                                |
| 标题        | 18/28px、700、uppercase                                             |
| 标题后间距  | 16px                                                                |
| 关闭        | 32×32px，SVG 20px                                                   |
| 正文        | 14/22.75px，black/75，后间距 20px                                   |
| 底部按钮    | 28px 高、12/12px、700、左右 padding 10px，右对齐、gap 12px          |
| 删除颜色    | #F97264                                                             |
| 忙碌态      | 10px spinner，取消/关闭 opacity .3，提交 opacity .8，禁止重复与关闭 |
| 错误态      | 橙色 20% 背景，2px 边框，12px padding，14/20px 正文，下面 16px      |

名称/准确文案不同会改变内在文本宽度和换行，不能把这些内容差异称为同内容逐像素验收。

2026-09-19 停止确认补充：复核 Raft v1.16.0 `index-CKeqacxz.js` 的 `zs`
确认组件，384px 宽度、24px 内边距和 14/22.75px 正文无需调整。
截图中的 Claude Code 比 Claude 更长，原提示因换行增高。RAH 本地措辞精简为
“确定停止‘名称’吗？停止后不再处理消息。”，保留自然换行及全部停止语义；这是本地文案调整，
不是上游逐字复用。`scripts/test-member-context-browser.mjs` 检查提示内容、
Claude Code 与短名称的桌面等高，以及 390px 视口、关闭与焦点交互。

字体取证：线上 `index-DPaRRgFJ.css` 声明 Space Grotesk TTF，但本次请求 `/assets/space-grotesk-0.ttf` 与 `space-grotesk-3.ttf` 均返回 404。Raft 标题实测宽 100.9609375px，删除按钮宽 86.9765625px；本地原 WOFF2 分别为 96.4140625px 与 85.9375px。临时浏览器实验改用系统字体回退后，度量与线上吻合（原生与 headless 舍入差小于 0.01px）。本批仅将该确认框的字体栈改为实际回退栈，根字号设为 16/24px；不修改全站字体，也不将无法加载的 TTF 宣称为已提取字体。若上游修复字体资源，需要重新复验。

## 验证

新增 Kernel 回归覆盖：在线直接删除、Inbox 不伪 ACK、排队取消、重复回放、持久恢复、拒绝重启/旧 Worker 回写、伪造退出身份、退出证明、权限与 freshness、任务保留/解除负责人、归档频道、提醒取消、输入及重分配取消。

`scripts/test-agent-delete-service-confirm-browser.mjs`：真实临时 Kernel/HTTP 的一次确认删除、刷新后身份消失；桌面/390px 尺寸；busy/Error/取消；原服务重启确认与 inspector 关闭按钮回归。临时状态和 Fake Provider，不是付费 CLI 验证。真实 Raft 不执行破坏性双边删除。

最终检查：`npm run check` 通过（核心 1565 通过、17 个显式跳过；Web 407 通过，其余子门禁通过），`npm run format:check`、`git diff --check`、正式 Web 构建通过。最后一次仅将确认框阴影从主题变量收紧为上游 `#141111` 后，组件源码规格门禁和五项专项浏览器检查再次通过；不将之前的全量检查冒称为该 CSS 微调后的再次全量运行。

正式实例已按闲置检查、在线备份校验、精确 PID 优雅停止、冻结资源启动流程重启。最终构建为 `e3a51e00e769fcbab020bec56ee03263447f452678fe08d915f48fcbea1a2158`；备份位于 `/Users/sun/.rah/backups/pre-restart-dc2babde-9ebc-4654-9c1a-11d975518efd`。

新建 Chrome 页面读取到该构建，四个真实 Agent 均保留。相同 1098×1172 / DPR 2 下，正式删除框 384×193.5px、墨色阴影 `rgb(20,17,17) 4px 4px`、标题宽 100.9609375px、删除按钮宽 86.9765625px，与本次 Raft 实测一致；在线 Agent 删除按钮可用。仅打开并取消，没有删除真实身份、运行付费 CLI、提交或推送。

## 随后的访问恢复

用户报告无法访问后，发现上述进程已经退出、4173 无监听。此前前台 restart launcher 继承执行会话，虽然交付时新页面通过，不能证明会话结束后服务仍存活；没有退出日志足以确定具体信号发送者。

恢复时确认持久状态闲置并备份校验，继续使用同一冻结构建。通过用户级 launchd 加载 `com.rah-os.repo-workbench`，直接运行已有仓库 launcher，父进程为系统 launchd；配置保存在 `~/.rah/run/com.rah-os.repo-workbench.plist`，不是旧 `rah` 仓库的 `com.rah.workbench`。未修改业务源码、数据目录、模型配置或网络权限，也未配置登录自启与无界崩溃重试。

启动命令已退出后再次确认 loopback/Tailnet HTTP 200，Chrome 经 Tailnet 地址加载真实的三个频道、四个私信和可用输入框。原先的交付存活结论以本次后台托管验收为准；不将同机 Tailnet 访问称为跨物理设备验收。

### 用户追问后的退出时间取证

2026-09-13 再次只读核查发现：桌面日志中本任务上一交付回合完成于北京时间 18:32:44.354；系统内核记录原 Node 进程的 LAN/Tailnet 4173 监听套接字于 20:02:44.948/949 同时关闭，间隔约 90 分钟。同一窗口 20:02:44.928，Codex 进程进入 exit handler。原服务日志没有异常堆栈，DiagnosticReports 未找到对应 Node 崩溃报告；这些阴性证据不能单独排除异常退出。

结合 restart 脚本继承 stdio、未脱离执行会话并转发 SIGINT/SIGTERM 的代码，会话到期清理是当前最强解释，仍没有直接证明信号来源的记录。不能把它描述为“回合结束立即退出”，也不能断言已排除业务崩溃。9 月 12 日另一次停服有明确 `LeaseConflictError` 堆栈，见[通知租约崩溃审计](2026-09-12-web-push-lease-crash.zh-CN.md)，不得归为同一原因。

本次核查后台服务为一次启动、从未退出、stderr 为空，HTTP 正常；未开启自动重启来掩盖退出。launchd 能保留当前服务的后续退出状态，独立 stderr 保存应用异常，但这不等同于所有崩溃风险已修复。
