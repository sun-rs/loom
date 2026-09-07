# 页面服务重启与官网对照进展

当前批次：翻译、语言/时区选择按用户决定排除；服务重启已完成实现、自动化和正式页面点击验收。

## 来源和实现边界

官网冻结来源 `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`
的 `Je`（字符位置 26956）发起 `computer/restart`，记录 requestId，等待状态完成；
请求返回不等于完成，超时显示失败。2026-09-07 官网实操 Computer 在线、重启可用，
升级因安装来源不支持而禁用；恢复指南原页展开。此行为采用为 RAH 本地适配，
不是字节复用。已有 Core stop/start 复用，无新远端 supervisor 或云服务。

协议 owner：protocol/workbench-service。部署 owner：daemon 的
restartable-local-workbench 与共享 service-control；Web 仅发送请求和核实恢复。
启动器 PID 保留，但 Core、AgentHost 和 HTTP 网关均重建。不是软件升级。

## 验证

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-service-restart`。

- RED：旧服务没有 endpoint；Settings 原控件违反新的排除要求。
- 生命周期：原 URL/会话恢复、实际 Host instance 变化；无认证/跨 Origin 拒绝，
  活跃 exclusive operation 阻止重启，旧 generation 不重启后继实例。
- 浏览器：Chrome/Firefox，1440×900 与 390×844，鼠标或 Enter 触发重启，
  页面确认新 generation；刷新与持久 Room/Message/Task/Principal 快照一致。
- 响应丢失：浏览器丢弃 POST 回执后，仍通过新实例状态确认成功。
- `npm run check`、`npm run format:check`、`git diff --check`、正式 Web 构建通过。
- foundation Chrome/Firefox 页面族回归通过；receipt `rah-ui-foundations-GJyTyd`。
- 正式页面点击、重新连接、刷新通过，`formal-click.json` 记录前后 generation。
- 正式发现页回归通过；receipt `rah-discovery-formal-wv1N3l`。
- 备份 `/Users/sun/.rah/backups/pre-restart-83f0476a-b995-420d-8d42-86f9aca90be5`；
  正式 build `46c4262563866f1952ec090d16d4647b2f1a036495fd708d8221681a74bcd15d`。
  发布更新后 Node PID 为 84980；随后页面点击重启保持该启动器 PID，完整重建服务。
- 前后内容快照一致：6 Rooms、43 Messages、2 Tasks、4 Agents、36 配置 revisions、
  37 记忆文件。正常 read-state 游标变化不算业务内容变化。没有新付费 CLI 测试、提交或推送。

## 官网同条件对照

本次用已登录 Firefox 响应式视口固定 1440×900、DPR 2，重置缩放 100%。
官方 Computer 初始页截图 `raft-computer-1440x900-dpr2.png`。
双方列表数据不同（官方 5 Agents，本机 4），不能以整图相似率宣称同数据验收。
既有截图/源码、隔离自动化与官网新实操分开记录。

当前确认：官方恢复指南可原页开合；Computer 服务重启与 Agent 批量 reset
属于不同动作；官方工作区列表包含仍存在 Agent 的目录，不能把“工作区管理”
统称为“已删除 Agent 清理”。删除 Agent 后留下的目录才是遗留目录；当前 RAH
扫描现存 Agent 的目录，尚无孤儿目录清理闭环，且该清理不能顺带删除正常记忆。

剩余同条件对照按页面族继续：Computer 操作/运行时/工作区 → Agent 资料与记忆 →
Room/Thread/消息动作 → Search/Tasks/Activity → 保留 Settings。每行分别记录
前置条件、官方触发/结果、本地业务结果、视觉结果和未通过原因；不把排除项当缺口，
也不把未测项填成通过。

## 本次明确未通过的 Computer 对照项

逐行证据在 `computer-comparison.json`。两张初始状态图均为 2880×1800 像素，
对应 1440×900 / DPR 2；本地使用等待管理权限加载后的 settled 图，不能拿初始
loading 禁用按钮当功能缺失。

| 行为                 | 官网                                       | 当前本地                            | 结论                                           |
| -------------------- | ------------------------------------------ | ----------------------------------- | ---------------------------------------------- |
| Agent 列表操作区     | 标题右侧；创建按钮粉色带图标               | 操作紧跟标题；普通按钮              | 视觉未对齐                                     |
| Runtime 标签         | Codex CLI 等产品名称                       | 带 native app-server / ACP 等传输名 | 展示未对齐，技术详情应留在 inspector           |
| Computer 创建者/时间 | 独立信息字段                               | 当前未展示                          | 需要核对 canonical 数据 owner，不能编造        |
| 目录扫描/清理        | 现存目录状态、体积、文件数、修改时间、删除 | 已有 Agent 的有界扫描               | 孤儿目录管理仍未收口                           |
| 服务重启             | 可点击并等待 operation 完成                | 正式点击后新实例 online             | 本地链路通过；未执行官方重启，不标完整双边通过 |

源码依据 hash：`5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。
另审阅 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/desktop/src/main/daemon-manager.ts`（585 起的 idle-before-restart）及
`daemon-recovery.ts`。它的 Electron 外层恢复/版本升级不是本地 Web 重启的必要依赖；
本批保留 RAH 既有 stop/start，采用空闲检查与真实恢复确认，不复制其自动恢复策略。
