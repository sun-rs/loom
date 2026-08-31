# ADR-0025：Agent Memory 的 Computer 归属与索引形成

状态：Accepted（保守归属 fence 已实现；跨机迁移和自主维护 runner 未完成）

## 1. 索引、正文、恢复点各自是什么

- `MEMORY.md`：稳定 Agent 的小型入口。Role 只作恢复提示，最新 AgentDefinition 才是角色/指令权威；沿用 Raft 的简洁完整索引和示例，不新增每条必填的结构。
- `notes/*.md`：依 Raft 原规则由 Agent 整理详细知识，包括偏好、项目/领域背景、工作历史、频道和其他 Agent；不增加 RAH 自定的“必须对当前 Room 以外有用”等写入前置条件。
- Active Context：沿用 Raft 的长任务前记录恢复点、工作后更新笔记/索引；撤回 RAH 自增的完成后仅留可复用经验等默认筛选指令。
- Room/Task/Message/Artifact：原始协作事实和证据仍留在 canonical owner，笔记使用引用定位，不复制整段历史。

生成顺序沿用 Raft：创建 Agent 时 seed 一次；当前 Agent 读索引、按需读主题笔记；学到耐久信息时先更新笔记，再维护索引；长任务前后整理恢复点。切换模型、effort、Provider/Room 不改变记忆 owner。

RAH 曾增加 4 KiB 索引写作目标；按 [Raft 基线优先合同](../product/agent-memory-raft-baseline.zh-CN.md)已撤下该默认指标及后续分块选择，恢复上游“简洁但完整”的写作与原文件读取。Raft 的 64 KiB 保留为 cleaner 告警阈值；bytes 不能精确换算成不同模型的 token。可选完整原文内联的 4 KiB 仅为传输上限。没有强制截断、后台直接改写或模型读取证明；提示词测试不能证明每个真实模型都会遵守。

## 2. 为什么需要 Memory Home

只有 per-Agent 全局执行互斥仍不够：先在 Computer A 执行、再在 B 执行虽不并发，B 却可能 seed 一份空白记忆，导致人格记忆分叉。

Kernel schema v19 新增 `agent_memory_homes`，唯一键是稳定 `participant_id`。第一次 managed Agent RunAttempt 在同一事务中绑定 `owner_host_id`，在 Runtime 启动/文件物化之前生效。考虑到启动失败可能已经创建文件，pre-start failure 也不自动释放归属。未管理、没有 AgentDefinition 的旧兼容执行不在此记忆策略内。

同一 Host 更换 instance generation、RuntimeProfile、模型或重启仍可继续；其他 Host 的 legacy lease、Placement scheduler、RunAttempt 创建及 Memory reset/maintenance 管理操作均拒绝越过归属。Memory reset 只清理内容，不移动归属。没有 TTL 接管，也没有“新 Computer 先试试”的空白回退。

升级时从已有 managed Agent RunAttempt 的 Host 历史保守回填：仅一个 Host 则绑定；出现多个 Host 则标为 `conflicted`，阻止所有 Host 继续启动/重置，等待有证据的人工恢复。既有 pin 不因历史清理或重启消失。

这只是安全 admission fence，**不证明记忆已复制、不防御同 OS UID 的恶意读取、不保证丢失磁盘后能恢复**。真正 handoff 还需旧 writer terminal proof、导出 digest、目的地私有目录导入/校验、原子切换归属、失败回滚和明确的恢复 UI；本轮不开放修改 home 的临时 API。

## 3. Cleaner 唤醒不是维护完成

沿用 Raft 1.0.18 `measureWithTimeout` 的 10 秒检查边界及 wake failure 隔离：检查超时/读取失败为 unknown，不能当作整理成功。过期结果不重建 hint。

RAH 加固如下：

- 正常 Activation 不等待 wake receiver 完成；失败仍保留 typed hint，不导致聊天启动失败。
- 同 owner 只允许一个未完成 wake callback；5 秒后发送 AbortSignal，直到 callback 真正结束仍不重复发起，避免不合作 receiver 导致并发维护。
- close/remove/reconfigure 会作废未完成检查和唤醒；迟到回调不能复活 Inbox。pending wake 不是 canonical 工作，不阻止关闭。
- callback 只能接收/投递 notice，不能绕过全局 Agent lane fence 启动第二个 Runtime。

正式 daemon 的 wake 仍为 unavailable；因此当前靠下一次真实 Activation 送达 hint。已运行的 Agent 可通过 Computer-local `agent inbox check/ack/recheck` 查看、显式确认和重查源状态。`check` 不消费、不测量，`ack` 不证明整理完成；读取失败为 unknown。同配置下过期测量也被作废，不能覆盖新结果或复活已确认提示。

独立 idle maintenance、active notice、启动恢复 schedule 与维护完成 receipt 仍需接线和真实验收。本 ADR 不把防护模块或 CLI 测试通过当作自治维护已经收口。

## 4. 来源

- Raft Computer 1.0.18：授权解包 bundle SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`；workspace seed、standing prompt、index/notes/Active Context、cleaner timeout/wake failure 为结构化移植基线。
- `thedotmack/claude-mem`：本轮只读参考 commit `fa6a1e9ec12d23f98326a9b26e243acb0819e105`，未导入代码/依赖、未安装 hook 或启动 observer。借鉴内容压缩、跳过无意义操作和索引逐层展开；不复制其以项目/工具事件为中心的采集链。
- Claude Code 官方 auto memory：参考小入口/主题文件按需读取；不采用 repo-wide 记忆 owner。
- Memory Home、全局 fence、路径/凭据安全和形式化测试是 RAH OS 自身适配，不冒称 Raft 原源码已有多 Computer migration。

本轮收紧：Claude-Mem observer 的 recording/skip 规则只作为研究证据，不再混入 Raft 工作 Agent 的默认提示词；此前借鉴不等于整体移植或效果验证。维护方案及全量哈希收缩以[当前计划](../product/agent-memory-raft-completion-plan.zh-CN.md)为准。
