# 单 Human 首版五项实施方案

日期：2026-09-07。依据当前 `rah_os` 代码、既有 owner 合同和
[最近收口审计](../audits/2026-09-07-agent-configure-closure.zh-CN.md)。
范围沿用[单 Human 主线决定](single-human-mainline-and-multi-human-backlog.zh-CN.md)。
这是当前约束下优先减少重复建设和返工的方案，不声称未经实验比较的绝对最优。

当前进度：第一至第三项的本地确定性闭环通过，详见[收口报告](../audits/2026-09-07-mainline-first-three-closure.zh-CN.md)。
第四项已补文件菜单、本机 MCP 和帮助反馈，第五项本地门禁已开始执行；
最新缺口与证据见[五项审计](../audits/2026-09-07-five-item-mainline-audit.zh-CN.md)。
四家指定真实 Provider 及双 Agent 冻结 Review 已通过，Computer 扫描/批量状态操作已补；
详见[最新真实验收](../audits/2026-09-07-real-cli-and-computer-closure.zh-CN.md)。
<=20 MiB 二进制媒体预览已补，见[限定预览验收](../audits/2026-09-07-media-preview-closure.zh-CN.md)。
Computer 三模式批量重启/重置入口也已补，见[批量恢复审计](../audits/2026-09-07-computer-bulk-reset-closure.zh-CN.md)。
PDF 缩放与页码跳转已补，见[阅读操作审计](../audits/2026-09-07-pdf-reading-closure.zh-CN.md)。
完整 Raft 双边、大文件流式/完整 PDF 工具栏与设备验收尚未收口，不由本地结果代替。

## 顺序和共同施工协议

执行依赖保持 **1 配置与运行 → 2 Room 协作 → 3 Task/Review → 4 使用页面 → 5 发布验收**。
页面里的具体操作跟随所属业务一起交付；不先做一轮全后端，再做一轮全前端。
第 5 项的验收设计从各项开始时就建立，最终只补跨流程和设备证据，不把问题全部推到最后。

每个施工单元写清：官方触发/源码位置/版本 → 当前前后端 owner → 可复现差异 → 一个可观察出口。
先读授权 Raft 源码与同条件浏览器行为，再比较 Multica 的具体实现；未知 Server 行为只做有证据的推断。
适合移植的源片段记录 hash/来源和本地差异；本地协议 glue 不标记为复制。
TDD 确认预期失败，最小修改后跑相关浏览器与业务结果，最后检查、备份、安全正式重启和新页面验证。
同一个施工单元未达出口不打开下一个；官网离线等外部阻塞单列，不以本地测试冒充双边验收。

## 1. Agent 配置到实际执行（本地闭环已验收）

**复用**：Kernel AgentDefinition revision/ExecutionPolicy/Placement，AgentHost registry 与
冻结 Run context，daemon execution reset coordinator，Web 配置与重置对话框。
私有记忆沿用单 Agent 的 MEMORY.md + notes；不新增运行时专属记忆。

**顺序**：

1. 配置不确定回执：已交付；保留同一请求查询原回执。
2. 重启/重置不确定回执：本次已复现 UI 重试产生不同操作键；一个对话框提交意图保留同一键和模式，
   复用 daemon receipt，确认不会再次重置。重载后不宣称存在客户端持久意图恢复。
3. 配置到下一 Run：沿 Human 配置→policy→选定 Offer→Placement→Host launch 的真实调用链，
   用隔离 fake runtime 记录收到的 revision/model/effort/cwd，与 canonical Run 对比。
   同时验证运行中的 Run 不被后续配置追写、下一 Run 使用新配置；复用现有测试补覆盖孔洞。
   当前贯通证据见[配置到子进程验收](../audits/2026-09-07-runtime-configuration-continuity.zh-CN.md)；
   fake 子进程已通过，不代替真实 Provider gate。
4. 启停/错误入口：按现有操作语义核对 busy、offline、permission、终态证明与恢复反馈；
   不把进程已停止等同 Task 完成，也不把 reset 回执解释成模型已执行成功。

**出口**：一次用户意图一次执行副作用；身份和记忆目录保持，明确的 full reset 例外；
历史 Run 配置不可变、下一 Run 正确，失败可回收且 UI 可恢复。
真实付费 Provider 验收另外记录，未经授权不运行。

## 2. Room 多 Agent 协作

**复用**：Kernel Room/Inbox/Activation/lease，AgentHost 单 Agent 执行 lane，Worker facade。
不以新的 Web 队列、模型轮询或 transcript parser 代替持久投递。

先列出 Raft agentApiContract 与本地 Worker 的逐行为映射，区分“名称不同但已有”与真实缺失。
优先检验消息/Thread 的精确目标与主负责人、helper、reviewer 的现有接线，再补单 Human
工作链确实需要的 Agent 搜索、reaction 等。每个新增命令由 protocol 定义、Kernel 处理，
MCP/CLI 共用 application service；认证身份只能来自当前 Run，不能任意传 actor 或扩大到全 Workspace。

**出口**：两 Agent 多轮协作、忙时新增消息、重复/丢失 wake、重连/重启均恢复同一因果链；
回复有明确归属，诊断输出不能完成 Inbox 或 Task。多人频道自助加入仍不在本阶段范围。

## 3. Task / Review 交付

**复用**：现有 Task intent 单 owner、次级角色、Submission 冻结证据与 Review 状态机。
先回放现有 UI 业务 gate，按未覆盖分支补“提交→审查→驳回→返工→Human 验收”完整旅程。
只修数据/动作/列表投影之间实际不一致；不再建设第二套看板状态。

**出口**：并发认领单 winner，普通讨论不隐式变任务；review 指向固定 submission，旧证据不被
新工作区覆盖；权限/过期上下文/重复提交有准确反馈；刷新和正式重启后状态、详情和待办一致。

## 4. 主线相关页面与本机管理

按实际主线阻塞程度处理：Agent Activity 可见更新 → 文件菜单/预览与交付 → 必要本机
Computer 恢复 → 必要 Settings/MCP/帮助。搜索、消息、通知已有实现，按登记逐状态核对而非重写。

视觉取授权 CSS/组件参数，经内部 ui-tokens/ui-web 共享 owner；同 viewport、DPR、zoom 做双边。
一次关闭一个菜单/表单/预览的加载、空、失败、禁用、键盘、关闭和焦点返回；同时查真实数据结果。
不靠 DOM 存在宣布完成，不新增页面局部覆盖解决共享组件问题。
文件由 Host root-scoped owner 提供；路径浏览不等于 Artifact 发布。官方 Computer 离线时，
非空文件树双边结论保持未验证。本机诊断不扩张为远程 Host 注册或应用市场。

**出口**：适用操作都有单一真实 owner 和逐行为证据；可选翻译等先明确适用范围，不把禁用伪装为实现。

## 5. 首版验收

锁定适用行为清单和冻结构建：确定性测试/隔离浏览器、正式持久实例、付费真实 CLI、
官网双边、物理设备分别记录结果。重启恢复、长历史/长期运行、故障注入与安装/PWA/通知实机
各自有出口；缺哪层就记录哪层，不用汇总测试数或百分比替代。

每批正式交付保留 idle 检查、数据库/记忆备份、精确优雅停止、冻结资产启动及新浏览器页。
活跃工作不能安全排空就报告阻塞，不强杀。不提交、推送、发布或运行付费测试，除非用户另行要求。
