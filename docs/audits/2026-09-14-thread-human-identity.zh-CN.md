# 消息列 Human 身份与 Agent 更多图标

消息列根消息与回复此前未向 MessageArticle 传入 Room 授权成员 Principal，
导致 Human 头像退化为消息作者首字母且无法打开 Human 侧栏。
现复用 HumanIdentity；姓名通过 WorkspaceEntities.resolvePerson 读取当前资料。
Room、DM 与 Thread 的消息呈现共享此 owner，不改写历史消息作者或新增身份缓存。

Agent 点击继续使用现有 openAgentPeek/activityRequest，每次打开重置为动态。
Human 使用现有 HumanProfilePane，无 Agent tabs。原有授权查询和资料更新 fence 保留。

## 来源与采用范围

Raft 发布包 index-MqTUR4Ez.js，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
本地授权分析副本位于 reviews/rah_os/2026-09-13-dialog-audit。
pretty.js 94669–94675 的 Ose 为 Lucide ellipsis-vertical：24×24 viewBox，
圆心 (12,5)、(12,12)、(12,19)，半径 1，默认 stroke-width 2。
161361 的消息列按钮使用 size 14。
复用内部 interaction-icons.svg 中已有图形及 PanelHeaderAction 的 14px 尺寸，
替换 AgentHeaderActions 的 20px/800 文字字符；属于共享组件接入，不是新复制资源。
原资源归属与许可沿用 ui-tokens 的 provenance。

## 验证

`scripts/test-thread-follower-profile-browser.mjs` 在修复前因消息列找不到 Human
头像按钮失败。修复后验证设置改名、历史根消息姓名、Human 侧栏无 tabs、
Agent 再次打开回到动态、14px SVG 图标，以及桌面/390px 分屏、焦点和移除确认。
不涉及付费 Provider 执行；不宣称本轮完成 Raft 同条件双边实机验收。

验收结果：Chromium 与 Firefox 隔离回归通过；`npm run check`、
`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
CSS matched-rules 证据和内部 catalog 已重新生成。
正式实例已在活跃任务检查、持久数据备份后安全重启；本机、LAN、Tailnet
新页面均通过 Human 头像打开无标签资料页、Agent 头像重置动态、14px 更多图标验证。
已查看正式桌面和 390×844 截图，Human 自定义头像及 Hakase 显示名一致。
未修改正式账号资料、未发送测试消息、未调用付费模型、未提交或推送代码。
