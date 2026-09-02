# Agent 资料编辑与模型配置验收

## 本轮修复

- 名称、描述从打开整套管理窗口改为 Raft 式就地编辑。
- 新增 Kernel `update_profile` 单字段原子更新；保留 revision、权限、幂等与 Room 因果校验。
- 资料修改与在线 runtime/模型策略解耦，不改身份、人设、技能、私有记忆引用、Host grant 或执行策略。
- 模型／effort 不是新造发现器：沿用已有真实 CLI 目录与 `configure`；新增直接点击芯片入口、可区分的字段无障碍名称、effort 展示标签。
- 并发旧草稿拒绝后保留输入；刷新 canonical revision，使取消并重开编辑可成功保存。
- Agent 管理员角色明确暂不可改；ADR-0012 的 Human-only 管理策略未放宽。

设计、来源哈希、字段长度差异见 [合同](../product/2026-09-01-agent-profile-edit-contract.zh-CN.md)。

## 自动化证据

先运行失败测试：新命令 schema 未识别；后端通过后 UI 键盘模块缺失；并发恢复测试显示旧 revision 未刷新。
修复后 `npm run check`：687 package + 102 web + 34 callback = 823 项，821 通过、2 项 opt-in 跳过。
TypeScript、正式 Web build、Prettier、diff 检查通过。构建仍有既有的大 chunk 警告，未在本轮处理。
协议入口通过原 1800 行 ratchet；提取 state 命令 schema，未提高上限。

## 真实浏览器

官方与本地桌面均实际设置为 1440×1000 CSS px；另测本地 390×844。
官方为已登录 Alice 资料，Computer 离线；名称就地编辑/Escape、描述就地编辑/Escape、运行时弹层/取消已观察。
官方运行时弹层明确提示无法从 Computer 加载模型，因此本轮不宣称官方模型保存双边通过。

隔离环境使用真实安装的 Codex/Kimi/OpenCode/Claude 发现目录，状态、工作目录、端口独立，不使用 Fake CLI 作为模型目录：

1. Codex 名称经输入框 Enter 保存，目录及资料同步回显。
2. 描述 Enter 保留换行而不提交；保存经真实后端持久化。
3. 点击模型芯片，选择 GPT-5.6-Sol；选择 Low，保存。
4. 刷新以及隔离服务安全重启后再次进入资料，模型/effort 保留。
5. SQLite policy 为 `exactBindingIds=["local:codex-cli/v1:gpt-5.6-sol"]`、`reasoning="low"`；Agent 身份稳定，全部 revision 的 persona/memory/skill/avatar 指纹一致。
6. 两窗口并发：第二窗口先保存描述，第一窗口旧姓名草稿被拒绝且保留。Escape 取消、重开后保存成功。
7. effort 下拉 Escape 仅关菜单，焦点回 effort 按钮；再次取消关编辑器。
8. 手机姓名草稿取消、模型弹层检查：视口和页面 scrollWidth 均390，弹层按钮可见。

隔离环境 Message=0、Activation=0；没有进行付费 CLI 推理，因此不是模型实际运行或跨模型记忆召回证明。
未改变 Raft 账号配置，也未改变正式 Agent 模型偏好。

## 仍有边界

- Agent 设为管理员与 Raft 不同；本轮不开放新的权限提升路径。
- Raft runtime 扩展 mode、环境变量等不是本轮全部适配的声明；已有重启/重置和问题报告缺口仍在。
- Agent tab 的 URL 恢复仍未完成；刷新后需要重新进入 Agent。
- 隔离 daemon 重启期间旧页面一度显示空 Agent 目录，刷新可恢复；自动断线恢复不能据此宣称收口。
- 未审计全部 Agent tabs；本报告只证明资料字段与模型/effort 配置链。

## 正式部署

备份：`/Users/sun/Library/Application Support/RAH OS/backup-before-profile-edit-wcONEA`。
已验证冻结构建：`22f46005bc08f7dadab0313f49356f9aac6df3f29f07e899f2e9feee21e1f57f`。
重启前正式状态仅有1个已完成 Activation、1个已退出 Run、1个已终止 RuntimeProcess，Task为空。
正式进程已从22937正常停止，新进程30900监听4173，并加载上述冻结构建。
新建真实浏览器页打开原 Codex DM，已有两条消息正常；头像点击打开动态侧栏、切资料、名称铅笔/Escape、模型选择和effort列表均实际操作。
正式模型试选全部取消，没有提交配置变更。
重启后与备份逐行比较：2 Workspace、6 Room、16 Membership、2 Message、4 AgentDefinition、8 AgentRevision、4 ExecutionPolicy、8 PolicyRevision 全部相同；8个非数据库私有文件逐字节相同。
正式入口：`http://127.0.0.1:4173`。隔离测试端口不作为交付地址。

## 头像入口与选择器补充验收

本轮补齐 Chat 私信顶部 Agent 头像、Message Agent 头像和资料头像选择器，来源与必要差异见同一份[合同](../product/2026-09-01-agent-profile-edit-contract.zh-CN.md)。两处 Chat 入口复用 App-owned `openAgentPeek`，默认进入 Activity；头像保存复用 `agent.manage / update_profile` 的 revision CAS，不新增客户端头像状态或第二个资料面板。

### 测试先行与自动化

1. 首次失败基线证明顶部头像没有回调、资料页没有选择器、Protocol 不接受 `avatarKey`。
2. 加入官方 allowlist、共享 inspector 入口、16 枚 preset 和 Kernel 持久化后，定向 Protocol/Kernel/Web 测试通过。
3. 正式页面首次键盘复核发现 Escape 同时关闭选择器和外层 inspector；先补失败断言，再以 capture 阶段消费 Escape 的最小修复收口。修复后只关闭选择器并把焦点还给“更换头像”。
4. 最终 `npm run check`：695 package（693 通过、2 项 opt-in 真实 CLI 跳过）、122 Web、34 callback 均无失败。
5. `npm run build:web:workbench`、`npm run test:web:workbench`、`npm run format:check`、`git diff --check` 均通过。`npm run test:web:browser` 最终完整通过，390×844 门禁实际保存另一个官方 preset，验证顶部与 Message 头像同步，并覆盖 Escape 分层关闭；没有运行付费 Provider。

### 正式工作台

- 重启前活动 Activation、RunAttempt、RuntimeProcess、执行中/待人工 Task、Agent 独占操作和已租赁 Outbox 均为0；Room 与 Runtime Registry 数据库完整性均为 `ok`。
- 一致性备份：`/Users/sun/Library/Application Support/RAH OS/backup-before-avatar-picker-Be2cdQ`。Room/Runtime Registry 使用 SQLite 在线备份，转换为独立 DELETE journal 后均可只读打开且 `integrity_check=ok`；关键业务表行数与停止前一致。
- 原正式 PID 14788 经 SIGTERM 正常退出；中间 PID 28116 用于发现并修复 Escape 层级问题后退出。最终 PID 32922 于4173监听，cwd 仍为本仓库，持久目录仍为原 `state`。
- 最终冻结快照为 `.workbench-web/972764920abb0a8aba65b0c0ad86aec6239e5f84fa9734d17585b7792264cf1f`；正式页和最终 `dist-workbench` 都返回 `/assets/index-oDMj5FZ7.js` 与 `/assets/index-BbaaBRq_.css`。
- 新建真实浏览器页冷加载原 Codex DM，原2条消息和4个 Agent 保留。顶部头像打开 Activity，Message 头像打开同一 Activity；资料页实见16枚 preset、1枚当前选中项和明确禁用的上传格。Escape 只关选择器、焦点回头像按钮，关闭 inspector 后焦点回顶部头像。
- 正式验收没有发送消息、没有选择新 preset，也没有改变正式 Agent 配置。正式入口仍为 `http://127.0.0.1:4173`。

### 未扩大声明

官方截图的自定义图片上传依赖尚未存在的 canonical blob/avatar owner，本轮只显示准确的禁用入口，不声明上传完成。头像交互已实现并通过本地正式浏览器与来源对照，但不据此宣称全部 Agent tabs 或全部 Raft 产品行为双边完成。
