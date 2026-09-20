# 新 Agent 首次初始化与 #all 报到

## 2026-09-20 后续产品修正：取消报到开关

按用户新要求，设置页与资料编辑草稿不再展示或写入报到开关。
新创建身份始终请求初始化与一次性 #all 报到，即使历史设置为 false。
旧协议字段和事件保留读取兼容；已排队请求、已存在 Agent 不追溯改写。
下文关于可配置开关的描述是本次修正前的历史实现记录。

先将 Kernel 测试改为“旧 false 设置不阻止新身份报到”，确认失败再实现。
保留原有投递、实际发言证明、幂等和执行围栏。新增隔离浏览器检查首次运行期间
聊天侧栏底部出现该 Agent 的工作动态；Fake CLI 延时只用于观察运行窗口，未运行付费模型。

正式只读记录显示这次新建到实际 RunAttempt 启动约 30 秒，其后有持续 working/thinking。
用户确认缺口是新建后立即查看时底栏无该身份。此前底栏只接受已经执行的轨迹，
排队请求被表示为普通 online/unknown，因此未显示。

后续修复：Protocol presence 增加 `reason=initializing`；Kernel 从已有首次请求事件与
queued/leased Activation 投影“等待初始化”，不建新队列、不把排队标为工作。
已有运行优先于排队；暂停/删除围栏不变。Web 底栏接受这一原因，直到 canonical
队列发生变化，不套用诊断 90 秒过期；启动后切回既有轨迹及过期规则。
先加 Kernel 与前端失败测试再实现。此行为是用户要求的本地显示补充，非声称 Raft 原样规则。

#all 报到后的五个其他 Agent 均有 room_policy Activation 并执行完成，未出现投递失败。
实际诊断明确将这条介绍解释为“无点名、无任务，为避免闲聊不回复”，没有 canonical
回复消息。诊断只用于解释原因，不当作已回复或 Inbox 已确认的证明。
本轮未加入强制欢迎规则、未伪造回复，也未修改避免无关对话的执行约束。

## 上游证据与边界

Raft Web v1.16.0，commit `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，
发布文件 `https://app.raft.build/assets/index-CKeqacxz.js`，SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
格式化取证 `/tmp/raft-task-readable.js` 的 153228–153245 附近：
`agentAllChannelGreetingEnabled` 默认开启，经 `/servers/:id/onboarding-settings`
保存，与人类引导 Agent 开关分离。Computer 1.0.32 的发布 `main.js`
（本机 raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.32）
844778、853003 附近可见 startup wake 输入与 `agent:start` 排队。
Computer main.js SHA256 为
`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。
发布 bundle 仅作分析证据，不引入产品依赖；Raft 许可/授权边界沿用
[复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)，不主张发布可读即开放许可。

实际 CLI 会话：本机 Raft 管理的 Claude 原生 session
`f7403373-b1c5-47a6-8398-728034b11a4d`，2026-09-18 13:23:31 UTC 首次输入
为 #all 一条系统 Inbox notice（message short id `all-gree`）。随后 Agent 读取
MEMORY.md，再执行 `raft message check`，13:23:42 UTC 的结果包含 system-triggered
onboarding：新加入 #all，先了解频道，以自己的口吻写一两句自然介绍，不用固定模板，
仅报到一次，之后恢复正常工作。Agent 接着读取 #all 并实际 `raft message send`。
证据来自现有 transcript，只读检查；未创建 Raft Agent、未运行付费 CLI。
`.slock/runtime-sessions/*.jsonl` 为 handoff 诊断壳，不能代替此原生 session 证据。
未复制本机配置、密钥、完整 transcript 或私人对话进仓库。

这证明首次报到来自系统收件箱请求，不是创建 MEMORY.md 的副作用；仍未获得 Raft
云端后台源码，不能声称其一次性记录、事务、重试实现与下面的 RAH 实现相同。

Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`，
`server/internal/handler/agent.go:1330–1460` 创建事务及 first-agent onboarding
统计、online runtime reconcile 已核对：没有对应的 #all 定向系统 Inbox 链。
其 Multica License 为 Apache 2.0 加附加条款；本批未复制其代码。
本地为 **Raft 行为的结构化移植 + RAH Kernel 接线**，不是字节复制。

## 唯一所有者与实现

- Protocol：Workspace 读模型、workspace.update 增加可选
  `agentAllChannelGreetingEnabled`。缺省 true；旧客户端省略字段不重置配置。
- Kernel：`agent-first-run.ts` 从 control Room 的 workspace.updated 事件读取设置。
  新建身份事务在 #all 成员协调之后追加一次 `agent.first_run_requested`，
  只定向派生该 Agent 的 Inbox、Activation、Outbox。按 participant ID 幂等；
  不新增客户端队列，不从 provider session 推断业务状态。
- 请求固定当次创建时的设置。开启要求读取身份/记忆索引、了解 #all 后自我介绍；
  关闭仍执行首次初始化与确认，但不要求报到。设置变更不追溯已有 Agent/已排队请求。
- 正式产品 bootstrap 先建立永久 #all。没有 #all 的 headless Workspace 不调度此
  产品行为；不将公开问候偷偷发到 control Room，也不自动补发旧身份。
- AgentHost 沿用能力清单、租约、RunAttempt、重试与停止/删除围栏。
  新私有工作目录需进入现有 runtime offer 清单；本批未改变其周期刷新策略，
  因此在线 Computer 上也可能等待下一轮约 30 秒的能力发布，不能承诺创建即刻启动。
- Agent 使用现有 Worker message-post 实际发言。保留键
  `agent-first-greeting:<participantId>` 绑定自己的定向请求及 #all 顶层消息。
  一旦提交，重试即使再生成不同文案也返回同一个事件，不再发一条。
  其他 Agent、没有对应请求的 Activation、消息列发言不能使用该键。
  普通消息仍使用原有内容敏感幂等规则。
- 完成 Activation 除原有 delivery/runtime/obligation 证明之外，还要求该报到
  message.posted 已落库。ack、exit 0 都不能代替发言；缺失走现有 durable retry，
  不改写已结束 RunAttempt。没有自动创建 Task，也没有 daemon 代写介绍。
- 正常重启、启停、换模型不会触发新的首次请求；删除后同名新建因身份不同独立初始化。
- UI：设置 → 服务器资料中增加“新 Agent 在 #all 报到”，复用现有开关与保存资料事务；
  沿用权限、待保存草稿、因果版本、失败提示与刷新读取。

## 验证

先修改 provision 测试，确认新身份的首次请求为 0 而非预期 1，再实现。
27 项相关 Kernel 测试通过，覆盖成员与请求同事务、定向租约、确认读取/成功退出
不能代替报到、实际发言、失败前重试、提交后跨 RunAttempt 重试去重、创建重放、
设置持久化、停用阻止领取、删除清理队列、同名新身份独立请求，以及既有删除诊断。
类型检查通过。

`npm run test:web:agent-first-run` 使用临时数据库、真实 Kernel/AgentHost/HTTP，
明确标记 Fake CLI。验证创建后实际报到、创建重放、不同文案重试仍一条、无 Task、
设置保存/刷新、关闭后静默初始化。未把 fixture 当正式地址，未宣称付费模型实测。
Chromium / WebKit 隔离真实浏览器流程通过；最后的 WebKit 门禁由 Fake CLI 进程
执行真正的 `"$RAH_WORKER_CLI" worker message-post`，验证 stdin、top-level、
保留幂等键和不同文案重放经过 CLI → HTTP → Kernel 的完整路径。
桌面 1440×900 与窄屏 390×844 截图已人工检查。

正式 Web bundle 构建、typecheck、git diff --check 通过。`npm run check` 仍在既有
`/v1/worker/message-present` surface 未登记处失败；format:check 的五个既有
wake/delivery 文件未改写。Web unit 449 通过、9 个既有源码形状断言失败，涉及
头像/侧栏、WorkspaceScreen、附件 overlay、reaction placement 和 Task marker，
均不在本批设置/首次调度改动中；不声称全量绿色。
完整 package suite：1747 通过、17 跳过、2 失败；失败为既有 RoomKernel 源码体积
ratchet（本批新增完成证明调用，未放宽阈值）与 interaction icon 冻结哈希不匹配。

正式工作台在活动检查、持久状态备份与校验后优雅重启，backup receipt
`pre-restart-a5ebfaa4-f75f-4b79-8826-1960cc0a95a4`，Web build
`012e38fe152f48dd532c863e841a1ed9507995190ab418019e970e203f6d39c5`。
新进程监听正式端口，新 Chromium 页确认服务器资料的开关存在且开启，截图
`/tmp/rah-first-run-formal.png` 已检查；未操作设置、未创建正式 Agent 或触发付费执行。
未提交、推送或声称真实付费 Provider 验收。

后续修正验收：Kernel 首次请求与 presence 三项测试、Web 类型检查、正式构建及 diff 检查通过。
全仓库检查仍受前述登记/格式项阻断。正式实例经活动检查、备份、安全重启，
冻结构建 `b125d1b29b17ea83b26e2b877bd25bee0959ac31712e7a4aa9ac9da17bf49cc8`，
新真实浏览器确认服务器资料已无报到开关；未创建正式 Agent 或触发付费模型。

初始化排队后续验证：六项 Kernel/前端测试通过，Chromium 按新身份头像验证等待初始化、
正在启动/工作中及实际报到消息的完整顺序，截图人工检查。正式再次备份并安全重启，
冻结构建 `44c36b695da8553ddb2240674417e940dc7baf83aa3f28c97da95fa5cfd1e91e`，
新浏览器验证设置页。未在正式实例创建测试 Agent。

## 动态栏单一状态圆点

用户截图要求底部动态栏只保留头像右侧的独立状态点。
`WorkspaceActivityFooter` 使用 `AgentAvatar` 已有 `showStatus=false` 参数，
其他侧栏项目、正文与资料头像仍沿各自原有规则。
浏览器首次执行门禁同时检查该栏头像角标为 0、独立状态点为 1，避免把整个状态反馈隐藏。

单点修正：浏览器断言先以 `{avatarDots:1,statusDots:1}` 失败，修复后为
`{avatarDots:0,statusDots:1}`，工作中截图人工检查通过。Web 类型检查、构建、diff 检查通过；
全仓库检查仍为上述既有登记及格式阻断。正式备份、安全重启后新浏览器聊天页加载通过，
构建 `da49d1ff966d9b91acee937b9058533addcbfe8f3b11c879300ad40cdd49bb78`；
动态状态本身在隔离 Fake CLI 环境验证，未触发正式 Agent 执行。
