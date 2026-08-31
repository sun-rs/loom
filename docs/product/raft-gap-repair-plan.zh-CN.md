# Raft 对照缺口修复方案

状态：2026-08-30，设计先行；施工与验收结论另记，本文不是完成声明。

后续执行结果：A 已完成代码与本机浏览器验收，见[配置闭环报告](../audits/2026-08-30-cleaner-config-closure.zh-CN.md)。B 的全局查询与操作链已落地，证据及未等同项见[第二批报告](../audits/2026-08-30-global-discovery-closure.zh-CN.md)。C–F 尚未由本文宣告通过。

## 依据与边界

起点是 [真实记忆及产品审计](../audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)。参考授权 Raft Computer 1.0.18 `main.js`，SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，本地位于 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/`。`memory-slices` 是检索切片；上游服务端不可见的部分不得称为直接移植。

保留 Raft 的 Agent 私有 `MEMORY.md` 小索引、按需读取 `notes/`、模型自行维护和按索引字节阈值提醒。此次不增加分类、切片、后台总结、向量库、全笔记启动哈希、重要性评分或项目硬隔离。只修已定位的产品/协议缺口。

## 分批顺序与必要性

| 批次 | 缺口及必要性                                                             | 唯一 owner / 复用边界                                                                                                                | 放行证据                                                                                            |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| A    | Cleaner 配置无法独立保存，Agent 改版覆盖配置；提醒里的调阈值动作没有闭环 | AgentHost 的 Computer 配置；复用 Raft `apps.getConfig/patchConfig` 的 revision CAS、三字段、set/unset、409 后重新读取                | 两客户端冲突、持久重开、Agent 改版与记忆 reset 保持配置、Human ACL、run-scoped CLI、浏览器保存/刷新 |
| B    | 左导航全局任务进入当前 Room 看板；全局搜索/动态缺入口                    | Kernel 权限过滤查询，Web 仅投影；以 Raft live 页面确认全局范围，不能拿 Room 缓存拼“全局”                                             | 同尺寸双边操作；跨 Room、私聊排除规则、无权限数据、清筛选、deep link 返回                           |
| C    | Provider 自带记忆可能旁路 Agent 隔离/临时对话                            | AgentHost spawn config；优先复用 Multica 的单次 Codex 配置模式，逐 CLI/版本证明，不改用户全局配置                                    | 真实 CLI 未带入标记的负例、Agent 间隔离、恢复普通对话、继承环境测试                                 |
| D    | idle 提醒没有自治启动，execution restart/reset 与安全改派未全闭环        | AgentHost 生命周期 + Kernel 独占 fence；复用 Raft restart snapshot / idle capability / app hint 思路，不把 wake 回调直接替换成 spawn | 无工作不启动、忙时不重入、关机不重启、崩溃恢复、撤销与旧 attempt 禁写、付费调用 opt-in              |
| E    | Notifications / InputRequest / Search deep link 与 Files 尚有断口        | Kernel durable Inbox/Artifact；复用 Raft 页面交互与 Multica 持久游标，不从 stdout 推业务事实                                         | 未读/已读持久、授权过滤、分页、刷新回定位、文件绑定真实 Artifact 和安全下载                         |
| F    | Agent/Computer 页面局部结构、图标与角色展示偏离 Raft                     | Web 共享组件和已提取 Raft token；人设不能变成 ACL 徽章，remote Computer 产品管理另排                                                 | Chromium 固定大屏视口双边；390px 同组件；截图与真实点击，不用编译通过代替                           |

A 先施工。B 紧随其后，但必须单独补范围反例，不借 A 顺手改导航。C–F 需各自设计/审计/验收，本文不授权在用户正式 daemon 上重启、重置或执行破坏性对照。

## A：条件更新与最小持久配置

Raft `src/commands/app/config.ts`（bundle 732460–732523）先 GET 当前 revision，再 PATCH `expectedRevision + set/unset`；冲突提示重读，不自动覆盖。`system.cleaner` 仅三个字段：`enabled`、`threshold_bytes`、`interval_ms`。默认 true / 65536 / 3600000；阈值 4096–1073741824，间隔 900000–604800000。独立 revision 从 0 开始，不再使用 AgentDefinition revision。

RAH 的适配是：protocol 定义严格 schema；AgentHost 单独小型 SQLite 配置表按 AgentParticipant 保存 override 和 revision；SQLite 已是本项目依赖，使用事务 CAS，不发明 lockfile 恢复协议。它存的是 Computer 配置，不是记忆文本/历史，不迁移 Room truth。上游服务端具体存储未见，SQLite 属本地实现差异。

配置数据库放在 Computer 私有 memory root 下、Agent 工作目录外。未配置 GET 返回默认 revision 0，不创建 Agent 文件或扫描 notes；第一次写入才创建私有数据库。数据库 0600、目录 0700，拒绝符号链接和不安全权限。使用事务提交作为成功边界；内存 timer 按已提交 revision 更新。关闭、reset 并发时不允许复活 timer；下一次合法 activation 从持久配置恢复。

PATCH 必须显式 revision。`set` 与 `unset` 不重叠；unset 恢复默认值但 revision 继续增加。两个同 revision 的写入只能一个成功；HTTP 409 无敏感路径。配置不会写 Room event、改记忆内容、产生 Task 或唤醒模型。`enabled=false` 只关闭大小提醒，**不是关闭记忆读取**。

Human API 使用现有 workspace Agent-management 权限解析 participant，不接收任意 filesystem path。Agent CLI 使用已存在的每 Run loopback 私有 capability，只能读写自己的 cleaner；保持 Raft 的“先读再条件写”行为。Web 放在记忆页面内，共用既有表单/按钮协议，显示 revision 和冲突，保存成功后重新读取。文件树的超阈值判定使用有效配置，不能继续固定 65536。

## A 的测试顺序

1. 先加入会失败的默认/持久化/CAS/非法配置/独立 revision 测试。
2. 实现 store 与 Coordinator；证明 reset 后配置仍在、disabled 仍可正常读记忆。
3. 增加 Human API、CLI 的身份/冲突/撤销反例，再接入实现。
4. Web 实际保存、刷新、恢复默认、双客户端冲突；1440×1000 和 390×844 检查布局。使用隔离临时 fixture，不重启正式服务。
5. 完整 check、format、diff 门禁。记录失败项和未验项，不能把 A 的通过称为全产品收口。
