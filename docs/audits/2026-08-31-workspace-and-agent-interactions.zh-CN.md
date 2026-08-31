# 空间标识、Agent 动态与消息身份交互对照审计

本轮开始于 2026-08-31，真实 CLI 证据在本机时区次日凌晨产生。目标和 owner 见 [设计](../product/identity-and-agent-interactions.zh-CN.md)。本报告取代本轮之前对这些具体入口的完成判断，不覆盖此前其他模块的证据。

## 结论

已打通并实际使用：空间名称/预设头像持久化；姓名点击插入提及；头像摘要；留在 Room 内的 Agent 右侧栏，默认动态；同一个详情 owner 的资料和模型配置入口；短动态标签与详情同行。不能据此宣称全产品或整个 Agent 管理已经 100% 等同 Raft。

正式 `127.0.0.1:4173` 服务没有在本轮重启或部署。验收使用隔离 4193（Fake CLI）和 4194（真实本地 CLI）环境，均不复用正式 Kernel 数据。正式 PID 最后只读检查仍是 80020；这是审计证据而非启动配置。

## 对照来源与复用边界

- 在已登录的 Raft 官方 `test` Room 上观察姓名点击、头像悬停和点击、右侧默认 tab、原位置保留，并读取 live DOM / computed style；未发送官方消息、创建 Agent 或修改官方设置。
- 官方与本地桌面对比使用 1440×1000 CSS viewport。官方右侧栏 x=1060、width=380；本地最终实测相同。头像预览卡 280px、2px border、4px shadow；本地读取真实模型后的实际高度约 338px，定位使用实际尺寸，不固定高度遮住下方。
- 短状态 label 为 14px / 20px、weight 500；灰色说明在后，间距 6px。最终 DOM 检查 label/detail 的 y 一致、x 间距 6px。长输出、thinking 独立成块；长命令窄屏自然换行，不以强制 nowrap 换取“同一行”。
- 黄色活动点 `rgb(255,212,64)`、青色输出点 `rgb(39,204,243)`；真实浏览器发现旧 success 选择器曾把输出覆盖成绿色，已重现、加测试、修复并重新读取 computed color。
- “资料 / 工作区 / 应用 / MCP”的 SVG 采用官方 DOM 原始路径，保存在 `packages/ui-tokens/src/interaction-icons.svg`；不是用 code/附件图标代替。bot 路径已有；新增 folder-open/link-2/blocks。资源有固定哈希回归。
- 文本合并参考本机已提取 Raft Computer 1.0.18 `chunk-ZHWD6VKE.js` 的 `queueTrajectoryText` / `flushPendingTrajectory`。350ms 同源连续文本合并；2000 字符边界改成无损分段而非丢弃余文，改变范围和理由已记录到设计并测试。
- Workspace API 和 React 交互 glue 按 RAH OS 的 Kernel/application/client 边界实现，不能称为拿到了 Raft 服务端源码。动态不解析屏幕 ANSI，也不从 Room box 推导工具调用。

## 已执行的浏览器链路

| 范围          | 实际操作与结果                                                                                                    | 证据性质                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 空间标识      | 设置名称 Design Lab → 首字母 D → 选择预设 robot → 保存 → 刷新，名称/头像保持；Kernel 关闭重开亦保持               | 隔离浏览器 + 数据库测试                    |
| 默认空间      | 新 bootstrap 使用核心 hostname；已有空间名称不覆盖；手机/执行机不会让标识变化                                     | bootstrap/迁移测试，非修改正式空间         |
| 空间计数      | 修正 Workspace 数量误用 Room 数量；此块是当前空间概要，不把两个 Room 显示为两个空间                               | 测试 + 桌面 DOM                            |
| 提及          | `keep draft ` 点 Alice → `keep draft @Alice `，焦点回 composer、光标位于插入后，没有发送或创建 Task               | 真浏览器 Fake CLI Room                     |
| Thread 提及   | `thread draft ` 点 Thread 中 Alice → `thread draft @Alice `；Room 草稿不变                                        | 真浏览器                                   |
| 摘要          | hover → 按需读取身份/runtime/model/最近五条活动；移入卡片仍可查看；离开/Escape 关闭；真实模型为 DeepSeek V4 Flash | 真浏览器 + 截图                            |
| 侧栏          | 点头像 → 默认动态，保留当前 Room；切资料 → 打开模型配置 → 取消；关闭/Escape 恢复头像焦点                          | 真浏览器                                   |
| Thread 与侧栏 | 从 Thread 打开 Agent 时 Thread 隐藏但不卸载；关闭后原 Thread 和草稿恢复                                           | 真浏览器                                   |
| 真实模型配置  | 在 Agent 资料设置 OpenCode 为 DeepSeek V4 Flash / Max，保存；随后的真实运行使用该配置                             | 真实 CLI 浏览器                            |
| 跨 Room 动态  | Alice 在频道与其 DM 分别收到 probe 并回复；同一动态页同时可见两处执行记录                                         | Fake CLI 端到端，不假称两次真实模型跨 Room |
| 小屏          | 390×844 同组件全宽侧栏；document scrollWidth=390、关闭按钮可见，展示频道+DM 两组记录                              | 浏览器缩视口，不等于 iPhone 实机或 Firefox |

空间表单还测试了 owner/非成员权限、stale sequence、同键重试、同键不同载荷冲突，以及 v20 → v21 迁移；不靠前端禁用按钮提供安全性。

## 真实 Agent 验收

只运行 OpenCode 1.18.22、DeepSeek V4 Flash、Max；没有触发 Claude/Codex/Kimi 的付费调用。临时工作目录 `/private/tmp/rah-identity-real-AWBiRL`，独立 Agent、Room、daemon、端口与状态库。两个提示都明确是短测试、不是 Task，不维护长期记忆。

| RunAttempt                                 | 完整结果                                                                                           | 动态记录                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `run_efe8434a-8aba-417f-8851-dcf87e08bc1e` | 写/读 identity-proof.txt → 显式私聊回帖 marker 和路径 → exited / 0；文件内容 RAH_IDENTITY_20260831 | 合并前 788 条，暴露 token 碎片占满默认历史窗 |
| `run_95ccbc5a-5f96-413a-b2bc-be0dbcdd41cb` | 写/读 identity-proof-2.txt → 显式私聊回帖 marker 和路径 → exited / 0；文件内容 RAH_IDENTITY_2      | 合并后 36 条，默认窗可覆盖该轮关键步骤       |

数据库核对：两次 Run 均 exited / 0；Task 数量 0；浏览器显示两条 Human 请求和两条 canonical Agent 回复；动态显示 Writing file / Reading file / Running command 等过程。文件长度分别 21 和 14 bytes，内容已读取核对。退出码不是单独验收依据，必须同时有文件和 canonical 回帖。

两次请求和实际工具数不完全相同，所以 788→36 **不是性能提升倍数基准**。合并不丢文本、350ms timer、切 kind、工具/status flush、跨 lineage 边界、单调序号由单测约束；不会回写既有历史碎片。

## 仍有差距，禁止误报收口

1. **动态语义分类**：真实 OpenCode 仍有重复 busy / “模型请求已开始”；某些恢复输入会作为 text 被列为“输出”。需要在 OpenCode Provider 观察入口按 message role / part identity 修正，不应在 React 猜测或过滤中文字符串。
2. **操作控制**：模型与 effort、现有资料编辑有真实写入；执行级 restart/reset 尚无完整前后端合同，仍禁用。报告问题也未接服务。Memory reset 与执行重启是不同操作，不能相互冒充；本轮没有触发破坏性操作。
3. **其他 Agent tabs**：提醒、应用仍是明确未实现占位，MCP/Memory 使用既有功能，本轮没有重做其全部业务验收。资料中 persona role 与成员权限角色的区分、Computer 友好名投影仍需校准；摘要当前可能展示 hostId。
4. **空间头像**：支持既有本地预设 key，不支持上传任意图片；已有正式空间不会自动改名。新默认名来自初始核心主机，而不是每个访问者的计算机。
5. **视觉范围**：只确认本轮入口/动态/侧栏及列出的尺寸、颜色、SVG；本地多一些诊断说明与安全禁用提示，未宣称整个页面像素 diff 为零。其他全局旧图标别名不在此次提取范围。
6. **环境覆盖**：本轮未跑 Firefox 或 iPhone 实机，未重测每种 CLI，也未升级正式 4173。不能用隔离环境截图证明用户现有正式页面已经更新。

优先下一批：Provider role/重复状态分类 → 执行 restart/reset 的排空/取消/持久化合同及真实验收 → 其余 Agent tabs。这里没有重新定义 Room/Task/Memory 或另造消息 truth。

## 门禁与证据

- `npm run check`：TypeScript 通过；660 package tests，658 通过 / 0 失败 / 2 个 opt-in 真实 CLI 门禁跳过；49 Web tests 全通过。
- `npm run build:web`：通过；仍有主 bundle >500KB 的已有构建警告，不能当成已完成首屏性能优化。
- `npm run format:check`、`git diff --check` 均通过；`npm audit --omit=dev` 为 0 vulnerabilities。当前报告不以测试代码替代上面的实际浏览器链路。

截图与 DOM（含隔离测试文本，注意不要作为匿名公共素材发布）：

- [官方桌面侧栏](evidence/2026-08-31-identity-interactions/raft-sidebar-1440.png) · [DOM](evidence/2026-08-31-identity-interactions/raft-sidebar-dom.txt)
- [真实 OpenCode 桌面侧栏](evidence/2026-08-31-identity-interactions/real-opencode-sidebar-1440.png) · [DOM](evidence/2026-08-31-identity-interactions/real-opencode-sidebar-dom.txt)
- [真实 Agent 头像摘要](evidence/2026-08-31-identity-interactions/real-opencode-hover-1440.png)
- [390 跨频道/DM 动态](evidence/2026-08-31-identity-interactions/cross-room-activity-390.png) · [DOM](evidence/2026-08-31-identity-interactions/cross-room-activity-dom.txt)

未提交或推送。工作树已有大量跨轮变更，本报告不将其全部计为本轮产出。
