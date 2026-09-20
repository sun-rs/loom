# 分栏缩放与拖动：隔离高频呈现更新

## 里程碑与来源

用户要求先保存 UI 里程碑：本地 commit `935a2a3`，未推送，未纳入临时 scratchpad。
本次优化以此为基线，不改变共享导航合同。

Raft v1.16.0 发布主包 `index-CKeqacxz.js` 的来源与许可边界见
[页面选择审计](2026-09-20-surface-selection-parity.zh-CN.md)。SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
W0（Tft 前的宽度 hook）在 pointermove 更新局部 state，结束才保存偏好；
Tft/Ift 管理紧凑/宽档。未发现该 hook 使用 rAF 节流，不把 Raft 的流畅性归因于节流。
仅分析发布源码，无 bundle 代码进入产品。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/desktop/src/renderer/src/components/workspace-route-layout.tsx`、
`desktop-layout.tsx` 使用路由布局及 SidebarInset；其切换挂载模型不足以替代
RAH 保留正文、草稿和滚动 owner 的约束，因此未采用其实现。无新增第三方代码或许可。

## 根因与设计顺序

1. 原 App 拥有全部栏宽。每次 resize/pointermove 重渲染 WorkspaceScreen，重新构造目录、entities、context 值及正文子树。
2. 先把宽度状态下沉到 `ConversationLayoutShell`，React 的稳定 children 保留正文子树；只有轻量 resizer 订阅宽度 context。App 只接收 split/replace/fullscreen 的离散变化，导航仍属于 App。
3. 这样连续拖动不再重建上述数据引用。没有另加全局实体缓存或到处 memo，避免引入错误失效条件与第二个数据 owner。
4. 测量 hook 的 ResizeObserver 生命周期只依赖容器，不再依赖 sidebarWidth。宽度偏好通过 ref 读取；移除重复 window resize 测量。保留即时反馈，不增加 debounce，不改虚拟滚动算法。

CSS 几何、断点、偏好 key、键盘/指针取消处理沿用现有 owner。
任务弹窗和设置抽屉保持独立语义；宽度变化不发起业务请求或新增导航。

## TDD 与浏览器证据

新增 `npm run test:web:resize-isolation` 使用隔离状态与测试期模块插桩，生产代码无计数器。
40 次连续缩放及 40 步真实指针拖动，RED：搜索 Workspace 重渲染 156/162 次；
观察器 RED：初始 2 次 observe，拖动后 42 次。
GREEN：搜索 0/0，动态 0/2，聊天 0/2；观察器不增加，栏宽保存及 reload 恢复通过。
少量异步数据更新允许发生，不要求停掉轮询。

- 类型检查、7 条 conversation 单元测试通过。
- Chromium/Firefox 共享导航：三大页、四层来源路径、1600/900/390 宽度及退出顺序通过。
- Chromium 历史搜索：轮询、资料、缩放、关闭后保持挂载通过。
- 滚动 owner：390×844 与 1440×844，搜索定位、延迟历史及用户阅读位置检查通过。
- `npm run check` 被存量 `/v1/worker/message-present` 未登记阻挡。
- `npm run format:check` 的存量五文件格式问题仍在；本次文件单独检查。

未运行付费 CLI，不声称当前 Raft 线上同数据性能双边验收。

## 正式版本测量与恢复验证

正式冻结构建 `7352335b6445d696797d48e7702ed15575bdb82246288cd7c0ace66354fbd5b1`
已通过守卫检查、持久状态备份、旧进程优雅退出及新进程启动。
新浏览器三大页宽/中/390×844、四层返回及 reload 通过；资料栏真实鼠标40步拖动后实际宽度增加、Home键恢复通过；截图人工检查，
历史 Kimi 搜索经过三次刷新仍不卸载消息列，资料切换和关闭通过。未发送正式消息。

Chromium CDP，正式相同 Room/旧消息列，1600×900 起始，80 次宽度设置：
前40步 `1600-i*19`，后40步 `859+(i-40)*19`，两次采样的累计 ScriptDuration：

| 大页 | 改前 ms | 改后 ms |
| ---- | ------- | ------- |
| 聊天 | 360–516 | 31–33   |
| 搜索 | 502–665 | 30–33   |
| 动态 | 176–303 | 24–25   |

首轮改后 LayoutDuration 为34/42/35ms，与改前接近。搜索最大帧间隔约43ms
降至27ms，但 p95 大体仍在26–27ms，不把总脚本耗时下降等同于帧率倍增。
两轮动态改前采样中有一轮未记录模式变化，故范围只说明开销观察，不宣称严格配对统计。
第二轮改后与另一只读浏览器验收有部分重叠。首轮改后单独执行。
各轮无超过50ms长任务；自动化节奏、数据轮询及机器负载仍影响结果。

Web 全量单元测试仍有11项已有源码/合同断言失败；本次宽度 owner 断言已随
所有权迁移更新，并与真实指针浏览器回归一起验证，未放宽交互要求。
