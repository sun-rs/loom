# 六项差异复核与分批交付

用户要求核查「审查rah_os (3)」最新回复，与该任务协调分批并行修复；本报告不将旧审计百分比作为验收。已有 Runtime 设置页与 Guide 默认开启保持不变。

## 复核裁决

| 项目                      | 当前事实                                         | 施工边界                                                                       |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| 投递与提示词、Claude 就绪 | 确认缺口；“不注入”是代码注释，实际缺少通知分支   | 本批实施模式共享、提示词与 fresh/resume 就绪；不冒充全 Runtime 常驻迁移        |
| Agent 默认 cwd            | Raft 按 Agent 分目录；本地共享默认路径不同       | 已委托原任务核验创建到启动路径及兼容设计，不用全局 exclusive，也不迁移既有目录 |
| Worker ACK                | 常规工具操作负担不同                             | 工具侧自动确认需单独设计输出失败/重试，不据此宣称任意丢消息                    |
| Task 外部合同             | status 输入及批量 claim 不同；RAH 已显示部分成功 | 先统一 freshness 批次与逐项结果，不把上游 CLI 文案当未知服务端事务实现         |
| help/mute                 | help 矛盾确认；mute 九字段为可选                 | help 本批修复；mute 需行为映射，不能编造值                                     |
| Computer 运维             | 按日期轮转缺口确认；清理/崩溃已有部分能力        | 分层核对实际入口；Raft 同样传 consented:true，不能据此改授权                   |

Worker 逐项源码见 [工具合同复核](./2026-09-11-worker-contract-second-review.zh-CN.md)，运维见 [Computer 复核](./2026-09-11-computer-ops-second-review.zh-CN.md)。原先仅建议阶段见 [生命周期审查](./2026-09-11-delivery-lifecycle-prompt-review.zh-CN.md)，本轮新增授权才实施以下内容。

## 首批：有效投递模式与会话就绪

上游 Raft Computer 1.0.18 提取文件：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- `buildPrompt` 736035–736066：direct 或目标通知的分支、内容为空不代表无工作、自然断点读消息再决定是否转向。
- Claude descriptor 758068 与 readiness 764676–764686：新会话等待 turn_end；匹配的恢复会话允许更早就绪。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `server/pkg/agent/claude.go:247–254` 同样在 result 关闭 stdin。未在此借用另一套投递算法；Raft 为主要行为依据，RAH 的有限执行继续保留。

### 唯一 owner 与适配

`agent-host/runtime.ts` 的 effective-mode 判定同时供 Host 和 daemon prompt 使用：Guide 开启、声明 busyInputSupported、存在 notifyBusy 且模式明确，才取 direct/gated，否则 wait。Registry 为已接通的 Codex/Claude 声明模式；未知模式不猜。Guide 仍由原持久设置 owner 管理，未新增队列/游标。

daemon 每次 preparation 重新读取设置并编译实际 `--prompt`。通知处理结构参照 Raft，Worker 命令、执行范围与有限 Run 是 RAH 接线。启动第 3 步也区分通知模式，避免正文为空即退出的矛盾。只携带通知不等于读取、ACK、回复或 Task 完成；已有目标与原任务不能因追加被替换。

行为分支参与 standing prompt digest；Room/Host/cwd 仍排除。切换模式可能产生新的 Provider session key，这是显式兼容成本，不能跳过摘要校验。Agent 私有 memory owner/文件不变；本批不宣称真实模型召回已验。

Claude fresh 在当前有限 Run 中拒绝忙时投递，保留 durable follow-up；只有明确 resume 且逐帧 session ID 匹配、当前输入已确认、工具/压缩边界允许时才写入。result 后关闭接收，绝不向关闭中的 stdin 追加。没有把 Raft persistent 生命周期声称已移植。

### 补测发现并修复

- 恢复失败后旧 gate 暂停了共用 stdin，fresh gate 只注册监听，无法收到后续 Host 重试。新 gate 明确恢复读取，并对 fresh notice 返回拒绝，等待工作仍留在 Kernel。
- 先前某轮失败、后续 result 成功时，失败虽未被当成功，却被错误描述为“成功后异常退出 code 0”。现在优先报告实际失败原因。

## 验证与交付边界

先运行新增测试确认失败：fresh 会话工具结束误放行、prompt 缺模式、mode 未进入 digest；补测确认恢复 fallback 暂停流和失败诊断两项失败，再实现修复。针对性 fake-driver、busy gate、Host 连续三条追加及 follow-up、compiler/lease 测试通过；包括错误 session 拒绝和终态拒绝。独立子代理进行了源码复审。

`npm run check` 通过：核心测试 1416 passed / 17 opt-in skipped / 0 failed，Web 单元 395 passed，其他合同/回归门禁通过；format:check、git diff --check 与正式 Web 构建通过。真实 composition→lease→最终 --prompt 三项测试通过，内存变异硬编码 wait 后确实失败。

正式实例在确认无活动执行后备份并温和重启。备份 `/Users/sun/.rah/backups/pre-restart-653ab01f-788b-4913-8c75-99571c9864b8`；本轮观测 PID 35405，4173，冻结 Web build `16c13e091631fe6e9afb2e2b61f79e6825ef22e3b367e850b86e900473da90ce`。正式 Chrome 新页面验证设置读取、开关持久化/刷新、未接通项禁用及桌面/手机尺寸通过，并查看截图；Codex/Claude Guide 最终仍开启，revision 14。证据在 `/Users/sun/Code/reviews/rah_os/2026-09-11-parity-batch-one/`。

这是首批代码、自动检查与正式浏览器交付；不是后续全部批次完成。没有付费 CLI、没有本轮 Raft 双边模型实验；不能据自动测试宣称追加时延或模型理解已完成验收。

## 后续批次的进入条件

1. 私有 cwd：先拿到完整创建→配置→启动路径方案，再只改变新建默认，保留用户显式目录及已有 Agent；独立失败测试后实施。
2. 工具 check/ACK：确定返回失败与重试的边界，保留交付和执行范围，不能收到 notice 就确认。
3. Task 批量与 status：先对照来源与状态权限映射，逐项结果不隐藏，freshness hold 不允许先有副作用再声称全未应用。
4. mute 与运维：按字段实际含义、进程层级、日志句柄/清理对象分别收口。

前两条可独立设计；涉及同一 Kernel/CLI 文件的施工串行合并。每批先源码裁决、失败测试，再实现、集成验收与正式重启；未通过的批次不标完成。

## 下一批已启动（不属于上述正式验收）

已向原任务 `01a08f85-7ced-77b2-ba68-b6d7fe4d42a2` 明确授权按 [私有 cwd 方案](./2026-09-11-agent-private-cwd-plan.zh-CN.md) 施工；第二批须覆盖 Host 投影边界、单 Agent 目录故障隔离、refresh/reset 同围栏与冻结 Placement 恢复。尚未部署该批，也不能用首批 check 结果证明其完成。

并行的 [mute attention 响应](./2026-09-11-worker-mute-attention-response.zh-CN.md) 已实现并由主任务复跑 72 项检查通过；主审发现并补齐了 shell 目标引用和超长可选指引的失败回归。其余源码正在施工，故此小批暂待联合全量验收与正式重启，不能混入首批部署声明。

工具侧自动确认的 [后续设计](./2026-09-11-worker-message-check-plan.zh-CN.md) 已指出 ACK 后失败必须能重读原 Activation，暂未实施。原任务完成第二批后将回传主任务触发独立验收；没有授权其自行提交、推送、付费模型或正式重启。

### 第二批主审发现：重置未决状态的重启边界

施工中主审复现：private binding refresh → quarantinePrivate（不 commit/rollback）→ 重新 open 同一 catalog → refresh 同一 binding，会提前重建 cwd 并发布 private mount。内存中的 resetting 集合不能表达跨进程未决状态。该复现证明目录准备和发布错误；Kernel 的 active exclusive operation 仍阻止调度，因此未据此宣称已绕过 Kernel 启动 CLI。

已交回第二批 owner 修复并要求失败回归：接入现有 AgentExecutionResetCoordinator 完成回执和 exclusive operation；未决时禁止目录重建/发布，完成回执已落盘而 finalize 未执行时继续 finalize，不再回滚已提交决定。必须覆盖部分回滚失败、回执落盘后退出、finalize 后围栏释放前退出，不能只以重启后拒绝一切代替可恢复性。

Raft `resetWorkspace`（上述冻结文件 766734）直接删除 Agent 目录，没有这里的持久重置事务。此要求属于移植 Agent 私有 cwd 时保留 RAH 既有恢复保证，不标注为 Raft 逐字复用。修复尚待对方回传和主审验收。

## 第二批联合交付：主任务验收完成

本节更新前文的“待验收/未部署”状态。私有 cwd/reset、mute attention 响应和 Runtime provider 图标/紧凑灰显页面已联合部署。上游来源及未实现的 ACK/Task/运维范围不变。

主任务独立复跑私有目录/重置/真实 Fake 子进程关键 21 项通过，检查权威完成收据、pending 重启阻断、历史操作不解除新操作、原 Placement 路径恢复。Chrome/Firefox 重置页面在 1440 与390尺寸共四场景通过，包含同操作失败重试；截图已查看。未运行付费 CLI 或本轮 Raft 双边模型实验。

全仓第一轮发现两处 source-size 门禁和 SVG 通配导出不符合实文件导出检查，已分别按原 owner 提取只读 placement 投影、daemon workspace composition，并使用四个明确 SVG 导出，未放宽门禁。第二轮发现旧 Computer 替换测试夹具在 listen 后、chmod 前提前校验 socket。临时子夹具延迟 chmod 250ms 可稳定失败，等待既有 FD3 ready 后通过；测试仍执行原 socket/HMAC 所有权证明。只校正 fixture 的就绪前提，不改变产品权限检查，也不声称该旧 coordinator 已接入生产。故障注入记录 `/tmp/rah-replacement-delayed.log` 与 `/tmp/rah-replacement-ready-delayed-green.log`。

最终 `npm run check` exit 0：核心 1477 通过、17 opt-in 跳过、0 失败；Web 395 通过，其余合同门禁通过。`format:check`、`git diff --check`、正式 Web 构建通过。日志 `/tmp/rah-final-integration-check-3.log`、`/tmp/rah-final-integration-format-3.log`。

确认正式无 active RunAttempt 后，备份至 `/Users/sun/.rah/backups/pre-restart-7b37ba00-db4a-461d-b282-de29f1b364d1` 并温和重启。观测新 PID 61404，正式端口4173，冻结 Web build `eb43b77b0dc22d67569d16ee14659e2fe70b2792ae83fdc5be70966096739e55`。正式 Chrome 新页面验证设置读取、点击修改、刷新后持久化、禁用项、恢复原 Guide 配置及桌面/手机截图通过；两份截图已查看，目录 `/Users/sun/Code/reviews/rah_os/2026-09-11-parity-batch-two/`。

已有 Agent cwd 不迁移，私有目录不等于 OS 沙箱；未决且没有完成收据的重置保守阻断而不猜测完成。隔离目录自动 GC、工具自动 ACK/重放、Task 批量合同及 Computer 其余运维仍是后续范围。没有提交、推送或付费模型测试。
