# Computer 页面对齐：操作区、运行时、创建时间与扫描信息

本批按官网已有差异逐项修复，不扩展多 Human 或远程 Computer。

## 来源与单一 owner

Raft Web 来源：`docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`，
SHA-256 `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。
`agentsOnComputer` action 使用 6px 间隔、12px 字号/图标和 4px×8px 内边距，创建为粉色。
同条件截图沿用上一批的 1440×900 / DPR 2 官网证据。

- 共享 `ProfileSection` 拥有标题操作区的靠右排列和紧凑按钮；不在页面追加覆盖。
- daemon inventory 从配置 manifest 的 CLI probe 或已知 CLI discovery 产生可选 `cliId`；
  `runtimeProductLabel` 据此映射产品名称，旧数据仅按精确 executable basename 回退。
  Computer、Agent 资料与实体卡片共用。未知执行器保留原名；诊断 inspector 保留完整
  transport/profile 名称。既有 Agent 的用户可编辑显示名称不随 runtime 标签改写。
- Kernel 的 `agent_hosts.created_at` 是首次注册时间；已有 heartbeat UPSERT 不改写它。
  经 Host projection → protocol → daemon inventory → Computer 页面传递。无新增状态存储。
  该时间是本地 Computer 注册时间，不假称操作系统安装时间。
- Workspace summary 的 `lastModified` 已由 AgentHost 有界扫描产生；本批仅补 Web 展示。

Raft Computer 1.0.18 源码参考：forensics 的 `packages/daemon/dist/chunk-ZHWD6VKE.js`
11443 起 `summarizeWorkspaceDirectory/scanWorkspaceDirectories/deleteWorkspaceDirectory`。
其最新 mtime 聚合已有本地结构化移植；不重写扫描算法或取消现有目录上限。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/desktop/src/renderer/src/components/daemon-runtime-card.tsx` 与
`server/internal/handler/workspace.go` 不提供更适合本页面的 Raft 视觉参数或本地目录清理 owner，
因此采用已提取 Raft 参数与现有 RAH owners。没有复制第三方整包源码。

## 验证与边界

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-computer-alignment`。

RED 已复现操作区不靠右、产品名称缺失、创建时间投影缺失、扫描未显示修改时间。
操作区/批量操作已通过 Chrome/Firefox、1440×900 与 390×844 的十二组合。
Workspace 扫描通过 Chrome/Firefox、1440×900 与 390×844 四组合。
最终 `npm run check`、`npm run format:check`、`git diff --check` 与正式 Web build 均通过；
Chrome/Firefox foundation 全页面族通过，回执目录为
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-1l7Ho4`。
日志为证据目录内 `check-handoff.log`、`format-handoff.log`、`foundations-handoff.log`。

实际页面复验发现并修复两项：版本化 Claude 可执行路径和 Kimi `main.mjs` 不能靠文件名
识别产品，故补后端 `cliId`；共享 action 靠右规则误伤字段编辑铅笔，故 field variant
保持紧邻标签。两项均先复现失败再修复，并加入回归。Human 页面验收脚本另修正为按
发送回执的 Message ID 等待并点击新消息，避免误点旧 Agent 提及；原业务断言保持不变。

正式服务已通过 guarded restart 部署 build
`2904a1ce8d8ba548d29bf39cfe38869458e2ff2322a463255e7b8f7da95194c9`。
备份为 `/Users/sun/.rah/backups/pre-restart-c15bd307-84db-45b7-ba17-f01ebde86b1c`。
正式 Firefox 新页面验证四种产品标签、真实注册时间、按钮颜色及位置、创建弹窗与 Escape、
真实工作区扫描及修改时间、刷新，以及字段铅笔位置；截图已人工检查。
证据为 `formal-result.json`、`formal-browser-handoff.log`、`field-green.log` 和两张 formal 截图。
持久数据快照逐字一致：6 Rooms、43 Messages、2 Tasks、4 Agents、36 配置版本、
380 Room events、37 私有记忆文件；Host 首次注册时间也未改变。

官网与本地截图采用相同 viewport/DPR，但官网 5 Agents、本地 4 Agents，故本批只声明
上述参数和交互的逐项核对，不声明整页同数据像素验收。不运行付费 CLI，不提交或推送 Git。

创建者没有可信的 Computer 历史记录，本批不把当前登录 Human 或 Workspace owner
伪装成创建者。孤儿/已删除 Agent 目录清理仍未实现；不能直接照搬 Raft 的递归 rm
绕过 RAH 的执行围栏与记忆隔离。这两项保留未收口，不宣布 Computer 整页完全对齐。
