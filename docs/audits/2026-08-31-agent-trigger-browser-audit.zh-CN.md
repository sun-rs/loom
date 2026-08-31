# Agent 触发点：源码合同、实现与双边浏览器审计

后续补充：[本地优先合同](../product/raft-frontend-local-contract.zh-CN.md)冻结了新的官方发布版，纠正本报告关于动态链接只能来自 metadata 的推论，并明确“官方离线”仅是现场对照缺证，不是 RAH 实现依赖。以下测试计数和结果保留为该批历史证据。

## 结论与边界

本轮完成了优先片段的实现和本地真实浏览器回归，**尚未达到整片段双边验收全部通过，更不能宣布 Agent 所有 tab 与 Raft 一致**。主要未通过项是官方离线 Computer 的非空文件树，以及精确 Task/Thread 操作目标。本轮不进入 Agent 全页面改版。

RAH OS 不安装 Agent CLI，不替用户配置账号；只发现用户已安装的能力、调用和管理。没有重做模型/effort 发现，也没有用这次 fixture 验收宣称各家真实模型再次通过。

环境：2026-08-31；Raft 已登录页面与隔离 RAH multi-agent fixture，双方实际 `innerWidth × innerHeight = 1280 × 720`，DPR=2。截图已经逐张查看；本次截图没有另存为仓库文件。未覆盖 Firefox、移动端或所有缩放比例。

## 六列验收账本

| 官方触发位置             | 源码组件及参数                                                                                                                                                     | 显示内容／数据来源                                                                                                           | 关闭和键盘行为                                                                                                       | 本地对应实现                                                                                  | 双边实测结果                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息头像悬停             | 官方 bundle `Mj/Nj/jj`；头像调用点 200ms 打开、120ms 关闭、280px 宽、6px 偏移／碰撞余量；不是组件默认的 80/40ms                                                    | Agent 身份、状态、描述、Computer、Runtime、模型、最近动态；本地 typed `agent.get` 与 `agent.trajectory.list(limit=5)`        | 本地实测鼠标移入打开、移到卡片保持、Escape 关闭；键盘 focus 也能打开。卡片为非交互预览，不伪装菜单                   | 共享 `PreviewCard`，移除消息头像自己的一套 timer/定位；异步请求取消                           | 双边看到真实摘要内容；本地测得宽 280px，底部空间不足时翻到上方。没有完成各视口与所有关闭条件的双边矩阵                                                                  |
| 消息头像点击             | 官方 message avatar → AgentDetailPanel                                                                                                                             | 对应长期 Agent，默认动态 tab；不是切换到私聊                                                                                 | 点击开右侧详情，本地可关闭；不发送消息                                                                               | `MessageAgentAvatar` → 现有 peek owner                                                        | 官方 Kimi、本地 Alice 均进入右侧动态；通过本轮桌面用例                                                                                                                  |
| 消息姓名点击             | 官方 `message-sender-mention-*` button；原生 title、hover underline                                                                                                | 向当前 composer 插入 canonical handle，不当作资料导航                                                                        | 点击后输入框获焦，不自动发送                                                                                         | 保留现有 mention owner，没有另做输入路径                                                      | 官方插入 `@Kimi `；本地插入 `@Alice `。官方测试草稿已用 UI 清空并检查为空；本轮没有向官方发消息。Thread 草稿独立性未在本轮重验                                          |
| 资料“角色”及问号         | 官方原生 `title="角色权限"`，12px circle-question-mark；点击角色说明框，实测 448px 上限、24px padding                                                              | Workspace 权限角色，**不是人设 prompt，也不是 CLI 文件权限**。本地由 Kernel control Room membership 返回；人设另列“人设指令” | 双边点击与 Escape 关闭；本地 Tab 限制在对话框、关闭后焦点回问号；官方此样本 Escape 后焦点落 body                     | `AgentRolePermissions` 复用 `useDialogProtocol`；现有共享 dialog 外壳                         | 语义混用已修正。故意保留 ADR-0012：Agent 只能 member，不复制 Raft 的 Agent-admin 写权限；文案如实说明                                                                   |
| 动态 `target` 小链接     | 官方 action metadata 的 channel/thread chip；实测 1px border、0.875em/1.3em、pink 30%/hover60%                                                                     | 官方是动作的具体目标；本地本批是 Kernel ACL 过滤后的 **Run 所属 Room**，明确写“对话”                                         | 双边鼠标点击返回频道并关闭右侧面板；本地保留原生 href 和修饰键行为。Enter 自动化在两边均未触发导航，不能记为键盘通过 | typed trajectory `context` → `AgentActivityPane` → 现有 `openDiscoveryLocation` owner         | 本地同一 Alice 的频道与 DM 动态都有正确来源。跨 Room 跳转不再遗留搜索的 message/thread 定位。精确 Task/Thread target 仍缺失，修饰键开新页未实测                         |
| 工作区 tab／文件树工具栏 | Computer 1.0.18 `getFileTree/readFile/listDirectoryChildren`：一次一级、目录优先、隐藏切换、text 1MiB/image 5MiB；官方树默认 256px；eye-off 的四条路径直接取 `cze` | Computer 映射 Agent 私有目录，不接受浏览器提供绝对根路径。RAH 当前暴露独立私有 home，**不是执行项目 cwd**                    | 本地目录展开、隐藏切换、刷新、ArrowRight/Enter 选择、关闭预览、Agent 切换均实测；复制路径尚待专门验收                | `AgentWorkspaceBrowser` → SDK → 授权应用层 → AgentHost 只读目录 owner；保留旧记忆管理在折叠区 | 官方显示真实路径、隐藏／刷新、空态，但 Computer 离线报“加载文件失败”。本地 Alice/Kimi 文件内容隔离、文本预览、HTML 当文本通过。非空树、预览及错误恢复尚不能宣布双边一致 |

## 真实回归中发现并修正的问题

1. 鼠标预览：初版在当前浏览器自动化鼠标移入下没有出现卡片，键盘 focus 可出现；改为实际鼠标 enter/leave 后重测通过。卡片内容异步增长会使虚拟列表调整滚动，不应把每次 scroll 都误作离开；现改为跟踪锚点定位。
2. 文件树：浏览器初测 Enter 没有选中文件；增加明确的树键盘处理，重新用 Kimi 的 `notes/guide.md` 验证选择及预览。初版还漏掉按钮原生背景重置及 eye-off 图标，已按样式／发布产物修正。
3. 搜索 → DM 消息 → 头像动态 → 频道链接：初版 URL 残留 DM 的 `message`，频道错误出现“已定位原消息”。改为复用已有 `openDiscoveryLocation`，不再写第二套半完整导航。失败用例重放后 URL 仅保留目标 Room，定位提示和侧栏均消失。
4. 冷启动复核：HMR 过程中一度出现预览上下文未接上的空内容；冷导航后重新核验带身份、模型和最近动态的卡片。没有把热更新截图冒充最终验收。

## 后端、数据及安全验收

- 文件列表/读取均先授权，I/O 后再次确认访问权与 owner；不能通过提供别人的 participantId、绝对路径或 cwd 选择根目录。
- 不存在的 Agent home 返回 absent，读取不创建目录或 MEMORY.md，不触发 Agent，也不更改记忆算法。
- 复用 Raft 类型／尺寸／隐藏规则，另外限制目录结果与扫描量，拒绝 symlink、hardlink、特殊文件、路径穿越及敏感文件内容；打开使用 O_NOFOLLOW，限制读取字节并检查文件身份变化。
- 这些措施不是对同 UID 恶意进程的完整文件系统沙箱，文件名规则也不等于识别任意正文里的秘密。不以这批测试宣称操作系统级隔离。
- `preview.html` 在真实页面显示字面的 `<script>…</script>`，预览区实际 script 元素为零；不把 HTML 当页面执行。
- 同一 Alice 在 Channel 与 DM 的两次 Fake CLI 回复与六条结构化动态已在浏览器看到；Search 找到两条 DM 消息，点击后返回相应私聊上下文。
- 运行时配置入口已打开验证，模型／effort 控件仍存在，取消离开；本轮没有修改真实 Agent 配置，也未执行付费 CLI。

## 来源、复用方式与差异

并非把一份 HTML 文件直接搬过来：Raft 发布 JavaScript 中的调用点参数、SVG 几何、文件服务规则是来源；RAH React 组件、typed SDK、Kernel 鉴权和导航接线是适配实现。六列账本用来显式记录适配差异。

- 前端冻结来源：`/Users/sun/Code/repos/raft-ui/vendor/raft/index-WTraJnrd.js`，SHA-256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。
- Runtime 冻结来源：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js`，SHA-256 `dcd61f0f7ce1c8804866a50f29c88ba34f6230b6dded4c0504994ea2eb7da2e0`；规则 13029–13044、常量 30559–30603、入口 34186–34245、一级目录 36583–36615。
- 追加 eye-off 后，本地独立 interaction SVG 的冻结哈希为 `b6615005c2f1c582d5908c50f6c75f9d82917ed23aee0c7d81777922319d81b4`。未修改 Raft reference snapshot 或生成资产基线。
- 本轮没有引入 Multica 或 OpenAgents 新模块；现有来源足够实现这一片段，未证明换来源更有价值。

## 未收口项与下一步

1. 官方 Computer 上线后，必须补非空目录展开、文本/图片/二进制预览、隐藏切换、刷新、失败重试、树拖拽宽度的双边验收。本地树尚未实现可拖宽分割线；项目 cwd/mount 也未接入，不能把私有记忆 home 当整个工作区已完成。
2. 动态精确 Task/Thread 目标需要扩展 typed action metadata，由工具调用 owner 提供并逐目标鉴权；不能从日志文本正则造链接。
3. 补 native Enter 激活、修饰键开新页、复制路径、Thread composer、Firefox/PWA 的明确测试结果。
4. 这些完成前，不宣布 Agent 所有 tab 对齐，不扩张整页改版。已有的模型发现/CLI 调用功能不因此重新造轮子。

## 工程门禁与交付状态

- `npm run check`：TypeScript 通过；packages 671 项（669 通过、2 跳过、0 失败）；Web 62/62 通过。
- `npm run build:web`：通过；仍有既有大 chunk 警告（主入口压缩前约 1.08MB），不据此宣称长聊天性能验收。
- `npm run format:check`：全仓通过；`git diff --check`：通过。
- 先跑失败测试再实现，覆盖文件边界、资料权限语义、预览参数、官方 eye-off 几何和动态导航 owner 接线；真实浏览器另复验，不把源码断言当作鼠标操作证据。
- 正式 RAH 服务没有重启、没有被本次 fixture 替换；未提交或推送已有的大量工作区变更。隔离 fixture 完成验收后关闭，不作为持久演示环境交付。
