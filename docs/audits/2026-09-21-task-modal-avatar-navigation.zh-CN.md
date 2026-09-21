# 任务审批内头像导航修复

## 根因与 owner

用户最终明确入口为“刷新 → 任务大页卡片 → 审批讨论头像”，不是动态页。
原 App 的已删除 Agent 分支写入全局 peek，但该 peek 仅在 Room 或搜索/动态预览
中渲染。任务页因此无可见目标。Human/有效 Agent 又走全局切页，混用审批弹窗
和底层导航状态；不能通过增加 PWA 样式特判解决。

TaskThreadModal 现在拥有审批内临时资料目标，覆盖子讨论的 Agent/Human 点击回调；
使用既有 AgentDirectoryPane/AgentUnavailablePanel 呈现，身份、权限和资料读取
仍由原 owner 负责。讨论保留挂载但隐藏，返回/Escape 只退出资料，之后才退出任务。
任务 ID 改变重建弹窗，避免把旧资料带入下一任务。不改主页面分栏导航。
聊天审批使用同一 presentation 入口；iOS compact 审批原本无讨论，保持原行为。

## 来源和本地差异

沿用 global-task-detail.tsx 已记录的 Raft release/v1.12.0 `index-BVfbaScj` db/t9
模态包裹 Thread 合同，以及现有 Agent 资料/不可用组件。本地来源与哈希见
[导航按钮审计](2026-09-21-navigation-chrome-roles.zh-CN.md)。本次为 RAH 模态
作用域接线修复，不宣称从 Raft 字节复制，也未宣称当前线上双边验收。
Multica 不拥有此 RAH 审批和资料组合，未引入额外路由或业务状态。

## 验证

扩展 test-deleted-agent-task-identity-browser.mjs：先确认点击删除头像后审批中
没有不可用页的失败，再接入资料渲染。覆盖冷启动、刷新、任务卡片入口、390/1440
宽度、删除头像、Human 头像、讨论节点保留、逐层 Escape 和键盘焦点。
最终检查及正式部署结果以本批交付记录为准；不包含付费 CLI 测试。

Chromium/WebKit 隔离测试均通过，包含 390/1440 宽度，另有原审批 full/compact
浏览器门禁通过。焦点门禁先暴露隐藏/负 tabindex 元素参与循环的问题，共享
useDialogProtocol 改为筛选实际可聚焦元素并显式处理容器焦点；手机和桌面 Tab
循环验证通过。无 source-size 上限放宽。

类型检查、正式构建和 diff 检查通过。全仓 check 在既有
`/v1/worker/message-present` 未登记处停止；format:check 的 12 项告警均在本批
未修改的既有文件及实验文件中。本批未提交或运行付费模型。

正式工作台安全守卫通过，完整备份 `pre-restart-9c811c57-499d-4a11-8676-5f2a9fef0618`
后启动冻结 build `6889f0bfe07d94ad1fdb0dd07b5e6c03e9a7ae7bf8e1bd29dd742d50c7f42ea1`。
新 WebKit 页面以 390×844 和 standalone 标志从任务大页刷新进入，三个正式任务
删除头像及 Human 资料返回均通过，其中一个包含有效 Claude 头像，连续打开及
返回亦通过；无运行时页面异常。正式复查仅只读，不发送消息或修改成员。
此为浏览器模拟移动 standalone，不声称独立安装 PWA 真机或 Raft 双边验收。

## 不可用标题样式修正

用户指出共享不可用页沿用了黄色图标及过大的标题。核对 Raft 留存的
`raft-web-20260831-current/AgentUnavailablePanel-CSrx1Kx9.js`
(SHA-256 `2f68c77eda16c0256a6de52b7f9eba57119e113f2855bd95d5f69b7f5328b9f0`)，
该组件向 PanelHeader 传 `iconBg: bg-gray-200`、bot 18px。
`index-BoAC7nSE.js` 的 xg 标题为 `text-base leading-tight font-bold`，
即 16px/20px/700，头部 gap-3 为 12px。灰色采用留存
`index-D8Neh8lc.css` 的 `--color-gray-200: oklch(92.8% .006 264.531)`。

RAH 新增维护 token `--agent-unavailable-icon-bg`，共享不可用组件引用；标题复用
现有 rah-panel-title，移除页面自身 20px/28px 和 16px 间距覆盖。
所有入口/设备共用此组件，无设备分支。仅样式参数结构移植，不复制发布 bundle。
已有本地组件足以承载该差异，不引入 Multica 或其他布局算法。
浏览器回归先确认实际 20px 而预期 16px 的失败，再校验手机/桌面字号、行高和底色。

样式修正的 Chromium/WebKit 390/1440 computed-style 回归通过，截图复核通过。
正式构建/类型/diff 通过；全仓 check/format 仍为上述既有阻塞。安全备份
`pre-restart-94d73541-04af-4764-95c8-badaf893b4b7` 后正式工作台已重启至 build
`62f6d83f6f1f69a26cd99da8df6681ef1ab25bfc582916a8d5b630c033506e13`。
新 WebKit 正式页面刷新后由真实任务进入不可用资料，390 与 1440 宽度均验证
16px/20px 和灰色 token；返回审批及 Human 资料仍通过。未提交。

## 审批容器返回与关闭语义（用户确认后的修订）

桌面审批内 Agent/Human/不可用资料显示左上“返回审批”和右上 X。返回只退出资料，
X 关闭整个审批容器；手机资料只显示返回。审批根页关闭行为不变，Escape 仍逐层
退出。此为用户明确采纳的 RAH 容器内呈现差异，不复制 Raft 的“隐藏审批后打开
任务大页右侧资料，再关闭恢复审批”。与现有频道设置内嵌资料的 onPanelBack/onClose
分工一致：复用该接口并允许容器提供返回、关闭名称，不新增人物或任务业务状态。

TaskThreadModal 仍是临时资料导航的唯一 owner。讨论隐藏但保持挂载，草稿和滚动
沿用原组件；关闭弹窗卸载局部导航，重开进入审批根页。所有人物种类共用这两个
回调；普通独立侧栏未传 onPanelBack 时行为保持不变。

定向回归新增返回按钮与桌面 X 的独立行为、草稿保留、讨论节点保留、关闭后重开
根页。旧实现首先因没有“返回审批”按钮失败；实现后检查 390 / 1440px 和删除、
Human 两种入口。键盘验证使用容器初始 Tab 和首项 Shift+Tab 反向环绕，避免依赖
Safari 系统前向遍历是否跳过按钮的偏好。

本次修订 Chromium/WebKit 定向回归、类型检查、正式构建、本批格式及 diff 检查通过。
全仓 check 仍止于既有 worker/message-present 登记缺口，format 为 12 个无关既有
文件告警。安全备份后正式重启至 build
`b7f7ba1c4b86aa33d71452ed27379ea955b33bb5ea3411f3002a391e3dce7609`。
新正式 WebKit 页面验证三个真实任务的移动端删除/Human 返回，其中包含有效 Claude；
另验证桌面返回审批、资料 X 关闭整个弹窗、重新打开无残留资料。未发送正式消息，
未提交，未运行付费 CLI，未声称手机真机或 Raft 当前线上双边验收。
