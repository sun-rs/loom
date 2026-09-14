# 成员右键停止 Agent 确认弹窗（2026-09-13）

## 来源和根因

Raft https://app.raft.build/ 冻结前端 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。成员菜单使用 `Gt && jsx(zi, ...)`，配置 `layout.sidebar.stopAgentTitle/stopAgentMessage/stoppingLabel`、橙色确认，未指定宽度或按钮尺寸覆盖。`zi` 默认 `max-w-sm`、`p-6`、`actionSize=sm`、20px X 图标，标题没有分隔线。中文正文为“确定要停止“{name}”吗？该 Agent 将停止处理消息。”，加载文案为“停止中…”。

本地 MemberContextActions 正确复用 AgentStateDialog 和原状态命令，但 AgentStateDialog 仍为 520px 通用弹窗，有标题横线、小文字 × 和过大的操作按钮。之前频道弹窗的修复没有覆盖此入口。

## 修改

停止状态复用现有 `rah-channel-confirmation` 紧凑确认样式（当前也供 Computer 确认使用），不复制第二份 CSS：384px、24px 内距、32px 关闭按钮和20px图标、28px 橙色操作按钮。采用 Raft 正文和停止中标签。详情页同一停止入口一起生效；启动、删除的语义与布局不变。原 canonical 状态命令、权限、幂等键、重复提交和迟到响应隔离保留。

原始发布 bundle 仅供分析，未进入生产依赖；这是结构性移植，不是逐字复制，不宣称获得上游后端实现。Multica agents 目录未找到对应 `stopAgent`/`Stop Agent` 弹窗实现，没有采用其新算法或依赖。

## 验证

右键入口浏览器先失败：520px 不满足 Raft 384px。修复后验证无标题线、32px X、28px 橙色按钮、正文、390px视口、取消、Escape、键盘菜单及另一个目标的重置窗口。既有状态弹窗 gate 继续验证桌面/窄屏、成功/错误、重复提交及迟到响应。正式结果见下文；没有运行付费 CLI 或对正式 Agent 执行停止。

补充边界：旧状态 gate 的 header 指针入口遇到 tooltip 遮挡（既有标题操作层问题），因此该 gate 用键盘 Enter 继续验证原本的异步状态所有权；本批目标右键入口仍使用真实 pointer，不使用 force click，分别验证取消、Escape、外部点击和焦点进入。未把 header 指针入口或 Raft 在线双边比较标为通过。

## 正式验收

`npm run check` 退出 0（核心 1559 通过、17 跳过，Web 407 通过），format:check、diff --check 和正式 Web 构建通过。成员右键真实 pointer 浏览器与 Chrome 桌面/390px 成功/错误异步 gate 通过。

空闲检查和备份后平滑重启，备份 `~/.rah/backups/pre-restart-e84f7f9f-3f15-4afb-80d2-ddf8936dcf27`，构建 `23b017da6f82bb9752cabdd555ba5e76724d2030904aeb9ecb207f92b09225e6`。原数据目录的新浏览器在 loopback、LAN、Tailnet 三入口均验证四个原 Agent、真实右键停止弹窗几何/颜色及390px布局，随后取消；没有停止正式 Agent。已人工检查正式截图。未提交代码、未运行付费 CLI，未声称 Raft 在线双边实测。
