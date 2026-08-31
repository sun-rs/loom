# ADR-0026：Raft 原始记忆入口与可选轻量项目提示

状态：Accepted，已按用户要求修订为 **Raft 基线优先**。M1 的 Markdown 分块选择已撤回，默认读完整原始索引；M2a 仅作为可选目录提示，错误不阻断正常 Agent。当前合同见 [Raft 基线与增强准入](../product/agent-memory-raft-baseline.zh-CN.md)。M2b 网页/跨 Computer 管理、M3 与真实模型 M4 仍未完成；未部署到用户当前运行实例。

研究依据：[Raft / Claude-Mem 索引与项目身份研究](../audits/2026-08-30-memory-index-project-research.zh-CN.md)。本 ADR 补充 ADR-0023/0025，不改变 Room-first、Agent memory owner 或 Computer home。

收紧修订：项目映射仅保留可选元数据与兼容读取；默认 prompt 不再要求模型据此写项目标签、筛选 notes 或遵守新增路径/验证时间写作规则。后文的跨 Computer 绑定及 M4 是未完成研究范围，不是继续扩展自有记忆引擎的授权。

## 1. 产品合同

- 一个 Agent 仍只有一份 `MEMORY.md + notes/`；不按项目/Room/CLI 克隆记忆。
- 项目是相关性提示，cwd 是来源位置；来源不等于适用范围，关联不等于同一项目，更不等于授权。
- 索引组织沿用 Raft 原规则，不强制每条加项目提示。显式配置的短项目元数据可供诊断；不把元信息变成新的记忆写作结构。
- 当前 cwd/Computer 属于运行上下文；历史笔记中的路径只能作历史来源，不能覆盖本次真实执行位置。
- 项目身份和元信息自动处理尽量由程序承担；不要求模型每轮做多维分类、晋升、跨库搬运。

此前的 `[rah_os] ... → notes/room-ledger.md` 是候选写作示例，现不作为默认要求。保留“不能仅按同名目录合并”的配置解析约束，不据此增加记忆分类。

## 2. Owner

- `packages/agent-host`：安全读取原始 memory、生成有界启动视图、提供执行位置事实、本地来源材料；local/remote/兼容 runtime composition 复用同一函数。
- `packages/protocol` + `packages/kernel`：后续显式项目绑定/关联与执行级 memory 读写策略；API、UI、AgentHost 不各自猜一遍项目身份。
- M2a 先提供 Computer 操作者本地配置的路径提示，不冒充上述 canonical 项目管理：协议归 protocol，私有配置读取、路径解析和启动来源记录归 AgentHost；Kernel 不从 cwd 猜项目，不增加记忆 owner。具体边界见 [M2a 操作与验收合同](../product/agent-memory-project-bindings.zh-CN.md)。
- Agent：在允许范围内判断相关性、整理主题笔记；不能自行把来源标签提升为授权。
- Web/PWA：展示和编辑正式配置，不产生第二套记忆或身份规则。纯 Raft UI 参考包不变。

## 3. M1 修订：原文优先，撤回语义选择

`RAH_AGENT_MEMORY_INDEX` 指向可编辑的原始索引，`RAH_AGENT_MEMORY_DIR` 指向原始 Agent 记忆目录。按照 Raft 启动合同，Agent 首先完整读取索引，再按需读取正文。Computer 不决定某条记忆是否应该被看见。

- 保留环境 `RAH_AGENT_MEMORY_BOOTSTRAP_JSON` 使用 schemaVersion 2。默认 `mode=raft_original/status=read_original/text=""`，只提供读取方式和可选短项目提示，空 text 不代表空记忆。
- 可选 `verbatim_inline` 仅在显式内部/测试调用中启用，生产 composition 默认不启用。只有整份索引连同 JSON 转义和元信息不超过 4096 UTF-8 bytes 才逐字内联，否则整份退回原文件读取。
- 不再存在 512-byte 块、Markdown parser、部分文本、`omittedBlocks`、标题重建、BOM/换行归一化或 cwd 过滤。完整来源不进入默认 envelope。
- 原始索引与 notes 不变，项目映射不另建记忆。缺少 envelope、旧版本或非 verbatim 状态均读完整原文件；文件工具分页时继续读完索引，而不是按内容挑选。
- 4 KiB 仅是 envelope 传输限制，不是上下文或磁盘读取预算。索引大小继续依赖 Raft 的简洁完整写作规则与 64 KiB cleaner 提醒；不再默认施加额外 4 KiB 写作指标。
- 原有私有目录、原文件读取安全、materialization receipt 与保留环境防伪仍在。普通启动现使用 v2 index-only 收据，不再枚举或哈希 notes；v1 仅作历史读取，不能用新局部检查重放旧全量收据。正文的显式查看继续检查目标及祖先路径。此 I/O 收缩独立于小 envelope，不改变索引原文或记忆写作策略。

部署边界：Worker 引导词由更新后的 runtime spec 生成，并直接复用 byte-exact Raft memory prompt builder，仅独立适配 cwd 与 RAH 安全规则。已有常驻进程、已冻结 RuntimeProfile prompt 和已开始的 Provider session 不会因源码修改自动更新；发布时须验证生效的 profile revision 与新 Run 环境。不得热改不可变 revision 或擅自重启用户服务。

## 4. M2：来源与项目绑定，保持轻量

M2a 已落地 Computer 本地显式目录提示和启动来源快照。缺失配置直接运行基线；非法配置由严格 resolver 拒绝，Activation 显式记录 unavailable 并继续无项目提示的正常记忆路径。cwd/记忆根安全错误不能降级。以下跨 Computer 正式管理与逐条笔记来源是后续可选目标，不再作为本机基线验收前置条件。不会暗中加入启发式归并：

1. 一个可复用的显式项目标识，可关联多个 cwd/checkout；保留人类短名称。先复用既有 Workspace/mount 已知事实，但不把其 ID 强行解释为项目。
2. Git worktree/仓库关系可提出或验证映射；用户绑定优先，unknown 不猜测。不同仓库共用 remote、monorepo 子项目和 submodule 都不能无条件合并。
3. 高度相关项目只登记关联，用于可选检索扩展；不复制笔记、不合并事实、不扩大读取权限。
4. 写入与检索必须消费同一个解析结果和映射版本；目录改名只更新位置，不重建 Agent/记忆。歧义显式呈现。
5. 来源信息由执行事实记录；模型判断“何时适用”。`updatedAt` 不能冒充 `lastVerifiedAt`。完整 cwd 只保存在来源详情，短索引引用一次可解析的项目提示。
6. 首版不建立知识图谱、多级分类器或后台模型项目推断器。

## 5. M3：普通/临时对话的强制控制（独立交付）

Kernel 冻结 per-conversation/Run read/write 策略；AgentHost 控制上下文、干净 Provider continuity、原生自动记忆和文件/工具通道；后续整理尊重来源的“不提升为长期记忆”标记。仅隐藏工具或删 prompt 不构成强关闭。同 UID/full-access 不能保证目录不可读；不支持强隔离的 Provider 必须明确降级或拒绝承诺。

临时对话不等于删除聊天历史、不等于服务商零留存。此阶段不得混入 M1 的“索引有界”验收结论。

## 6. M4：真实业务对照与退出标准

同模型/同问题对照 Raft 式原始索引基线与新入口：跨 Room 召回、多个 cwd 同项目、相关但不同项目、同名独立项目、普通无项目聊天、临时模式。比较跨项目误用、漏读、实际启动内容大小、额外读取次数、延迟；不凭回答“我没读记忆”验收。

M1 必须先通过：

- 上游切片 SHA 与实际 prompt 正文一致性；默认读原文件，可选内联整份原文，Unicode/JSON 转义后总大小和溢出整份回退；
- 原始文件与 Agent owner 不变，缺省/旧索引可用，无文字切分、限定条件丢失或项目范围脱离；
- receipt 内容匹配、超大文件降级、符号链接/非法 UTF-8 拒绝；
- local coordinator、无 coordinator fallback、remote composition、兼容启动复用同一生成 owner；
- 真实子进程收到有界入口且父环境伪造值被清除；
- `npm run check`、`npm run format:check`、`git diff --check`。

当前不改 UI；不把子进程门禁说成真实模型选择正确，也不借用之前浏览器截图作为本次语义召回证据。付费真实 CLI 与 live daemon 部署另行按明确授权执行。

## 7. 历史 M1 记录（选择算法已撤回，不是现行合同）

已落地：

- [agent-memory-bootstrap.ts](../../packages/agent-host/src/agent-memory-bootstrap.ts) 是唯一有界视图生成器，保留源顺序、标题上下文与完整块；不生成第二份持久记忆。
- [agent-memory-activation.ts](../../packages/agent-host/src/agent-memory-activation.ts) 统一 materialization、内容核对与环境交付。coordinator、本地 fallback、远程 fallback 共用；旧 schema v2 启动经 coordinator 复用此路径。
- GenericProcessAdapter 清除父环境和静态配置伪造的 bootstrap；RuntimeProfile 既有保留前缀验证继续生效。
- Worker 引导词优先读取有界入口，明确遗漏不等于没有记忆，保留按需读取原始索引/notes 的路径；项目语义仅为提示，尚未新增项目绑定存储。

先复现失败再修正的边界包括：重复父标题被省略导致作用范围改变、索引条目附带的代码段被拆开省略、UTF-8 BOM 导致合法原始文件与 receipt 被误判不一致。原始文件仍逐字保留；显示层仅规范 BOM/换行与空行。

最终验证：

- 7 个相关测试文件共 **50 项通过**：视图预算、Unicode/转义、原文件不变、超大旧索引、digest/非法 UTF-8、Agent owner、真实 Node 子进程、local/remote fallback、父/静态环境伪造清除及引导词合同。
- `npm run check`：类型检查通过；后端 **619 项，617 通过，2 项付费 CLI 门禁跳过**；Web **25 项通过**。
- `npm run format:check`、`git diff --check` 通过。

证据强度：跨 Room/RuntimeProfile/registry 重建的子进程验证是实际 OS 进程执行，但使用测试 Worker 和模拟模型标识，并非真实模型召回实验。兼容 schema v2 的统一 owner 由调用链审查确认；不声称对每家 CLI、每种 Provider 恢复状态完成了 M4 验收。未修改 Raft UI 参考包、未运行付费模型、未做本轮浏览器验收、未部署/重启用户服务。

上述历史顺序已修订为：**基线修复 → M4 当前普通记忆真实业务对照 → 最小配置可见性 → M3 普通/临时策略及其独立 M4 验收**。跨 Computer 项目注册与全面结构化来源后置。同项目多目录不重复建库、同名无关项目不误合并、关联项目不自动成为一个项目的约束继续保留。

M2a 的实现、配置方法与证据后续单独记录在 [轻量项目目录绑定](../product/agent-memory-project-bindings.zh-CN.md)，不改写上述 M1 历史测试数量。
