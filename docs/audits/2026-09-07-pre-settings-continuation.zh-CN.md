# 第七项之前的连续施工

范围更新（2026-09-07，用户后续决定）：本报告保留实现/测试历史；其中公开频道优先收口、
暂停其他主线施工的要求已撤销。多 Human 功能整体延期，按
[单 Human 主线决定](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)继续推进。
延期不代表公开频道完整复刻通过。

## 用户纠偏：当前只收口公开频道（2026-09-07）

用户明确要求“一事一闭，优先收口”。当前唯一施工范围锁定公开频道的 Human
发现/阅读/Thread/本人加入与退出；该范围完整验收前，不推进文件预览、Agent 资料、
Computer 或 Settings。前文/下文的后续缺口是背景，不是并行施工许可。
不再以增加测试数量、完成零散修复或缩小验收描述替代此范围的完成。

本次重新打开真实 Raft 已登录页面，实操公开 `#test` 的退出确认、退出后的阅读、
已有 Thread 打开、Thread 的“加入频道以回复”、关闭 Thread。最终恢复到原 Search +
Channel 位置，加入按钮消失、频道 composer 恢复。没有发送消息、修改内容或请求 Agent 执行；
页面读取可能更新个人已读状态，不能声称外部状态完全未变。

直接观察修正此前未验证假设：

- 退出后 Search 左栏和 Channel 右栏均保留；Chat/Tasks/Files tabs 仍可见。
- 非成员消息仍显示已有作者、头像、Task/Thread 信息，以及回复入口和收藏按钮；reaction 入口消失。
- 已有 Thread 可打开并读取；底部为“加入频道以回复”，加入后恢复输入框。
- 退出确认明确保留已关注公开 Thread；这个说明是产品合同证据，并不是本次完成通知送达测试。
- 本次未点击非成员 Tasks/Files 内容或执行收藏，不能把“入口存在”外推为这些业务都已验收。

当前不宣称公开频道完成：本地仍缺非成员完整 tabs、Thread 进入/返回组合、身份资料一致性和
收藏读写/权限闭环；此前统一关闭 MessageSocial 的处理也不等同官网“保留收藏、禁止 reaction”。
应在现有 owners 上补齐：presentation 复用已有组件，读取共用 content-reader，写入按具体动作
授权；完整 sync/ACK/Agent execution 的 membership gate 不放宽。

收口出口固定为：逐项官方来源/实操证据 → 前后端可观察失败测试 → 最小修复 →
源码冻结 → 全量/浏览器验证 → 安全正式重启与持久状态比较 → 更新行为登记。
所有已知修复完成后才开始最终冻结验收；测试期间不继续修改其他源码，避免产生失效回执。
只有退出条件全部成立才切换施工项；官网或权限条件受阻时明确记录阻塞，不转做别的页面凑进度。

范围只含独立 rah_os；用户所说第七项是 Settings/MCP，Computer 仍在本轮范围。
先前九行施工表拆开了 Room 两步，编号不同，不能按其第七行误删 Computer 范围。
下列子链路已交付并恢复正式实例；前六项整体仍未完成。当前验收以末尾“本轮交付结果”为准。

## 已实现候选及证据

- Human public content reader 共用 policy；preview/Search/context/navigation/已发布附件同一当前权限。
- 加入回到现有 Room session/composer；public read 不产生 delivery ACK、Inbox 或 Activation。
- Search 左栏保留、URL preview 重载/返回、权限失败清屏；官方 Escape 观察纠正了原快捷关闭假设。
- 退出后关注 Thread 保留到 Activity；取消关注、私有化撤销有效；普通频道未读与 Task 详情仍受成员边界约束。
- SDK/Core 新接口清单已更新；Search 历史旧 Room 覆盖有 RED/GREEN 回归。

外部可复核日志目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-pre-settings`。
`public-read-red.log`、`public-files-red.log`、`preview-history-red.log`、
`follow-red.log`、`thread-preview-red.log` 分别记录对应失败；focused green 对应修复。
第一版公开预览/加入/发送已通过 Chrome/Firefox × 1440/390。
加入 Thread Activity 后的 Chrome 桌面/移动通过；最终组合与全量检查结果见末尾交付段。

## 尚未收口，不得外推

前端：非成员完整 Chat/Thread tabs、消息动作与已加入视图统一呈现；媒体草稿缩略图；
文件菜单/复杂预览；Agent 各 tab 与 Computer 恢复入口还需逐项处理。
后端：Raft Agent 侧 channel join/leave/search 等与 Room-scoped Worker grant 的映射尚未完成，
不能用 Human API 的通过代替 Agent API 对等。当前没有放宽 Worker 凭证。
验证：官网只实操了已加入 Channel 的 Search 右面板与 Escape；非成员、非空数据的同条件双边尚未完成。
本轮未运行付费 CLI、未提交或推送。正式资产、持久备份与启动已核验，见末尾交付段。

## Agent 与 Computer 的具体剩余接线

源依据：Raft Computer 1.0.18 提取文件
`packages/shared/src/agentApiContract.ts`（本地 forensic source-slices），
messageSearch / messageReactionAdd / messageReactionRemove / channelJoin /
channelLeave / channelMute / profileUpdate。Worker 实际入口依据
`packages/application-service/src/worker-application-service.ts` 的
`WORKER_HTTP_ROUTE_PATHS` 和分派实现，不用 Human 路由数替代。

| 行为                 | 当前 RAH owner / 事实                                                                          | 未收口部分                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent 消息/工作      | scoped sync、explicit post、Task claim/start/progress/review/submit、Reminder 已有 Worker 路由 | Search、reaction 没有同等 Worker facade；需要绑定当前 Run/Room 权限的命令合同和测试                                                                     |
| Agent 加入/退出/静音 | Human 已有对应部分业务能力；Worker 仅有 Thread unfollow                                        | Raft 的可见频道 scope 与本地 Activation scope 不同，不能把 Human self-join 给 Agent 调用或发全空间 Token；需显式 Agent 身份资格与当前执行围栏的共同检查 |
| Agent 资料           | Human 管理与 durable AgentDefinition / RuntimeProfile 分属既有 owner                           | Raft profileUpdate 到 Agent 自改角色/名称的允许字段、审计身份及 revision 冲突尚未完整映射；不得允许 Provider 输出直接改身份                             |
| Agent 正文页         | Activity/Reminder/Workspace/Profile 已接现有业务与路径授权 owner                               | 当前累计浏览器旅程继续检查已有场景；完整官方同条件正文/错误/权限矩阵仍不是已完成事实                                                                    |
| Computer 本机        | workspace-catalog-panes.tsx 有 runtime inspector、绑定 Agent、经过裁剪的诊断复制与 doctor 命令 | daemon/resident 恢复能力不等于 Web Human 入口已闭环；当前没有完整的前端恢复管理回执。远程 Host 注册不在单机批次补建                                     |

后续顺序仍是先收口非成员完整会话呈现/Agent 频道权限合同，再完成文件类型预览，
再逐个 Agent 正文与对应 facade，最后 Computer 本机恢复。Settings/MCP 不进入本轮。
这张表是当前源码差异解释，不表示已通过对应真实 Provider 或官网验收。

## 文件与 Room 回归

文件图片 Blob 生命周期已由原 FilePreview 提取到单一资源 helper；延迟响应关闭后不分配 URL，
完成后关闭只释放自己的 URL。`file-preview-resource-red.log` 使用原分配顺序重现失败；
`file-preview-resource-green.log` 覆盖该不变量与既有预览合同。
未增加 PDF、音视频、额外上传队列或本机任意路径访问。

Room 生命周期 16 个 Chrome/Firefox × 桌面/移动 × 退出/删除 × 普通/丢失回执场景均运行过。
第二次运行因测试期间新增文件而被输入快照门禁作废；它只提供诊断信息，不能作为最终冻结验收。
最终冻结运行单独记录。该严格门禁保留，没有降低断言或放宽源码规模门槛。

## 最后视觉复核与组件收口

截图检查补获移动返回按钮被旧全局 head-actions 样式隐藏；回归先断言可见点击目标，
然后把返回动作放回共享 Header 的移动位置。未增加页面 CSS 覆盖。
非成员消息现在复用原 `MessageArticle`，共享头像后备、时间、长消息折叠、Markdown、
附件与 forwarded 内容呈现；通过已有 disabled MessageSocialProvider 关闭不可用动作。
公共作者的完整头像/资料投影及非成员全部消息操作仍需后续合同，不能声称该视图完全等同官网。
原粗略消息行已删除，没有维护第二套消息 renderer。

累计 Chrome 真实业务旅程已通过（`business-browser-final.log`），覆盖文件预览/下载、
Agent 管理/Workspace 和 Computer 资料等已有场景；这不代表全部 Agent API 和恢复管理补完。
最后的新预览移动返回/共享消息行仍以最终 public delivery 矩阵为准。

## 本轮交付结果

- `npm run check`：915 package tests 通过、2 个付费 CLI opt-in 跳过；355 Web、34 parity、9 formal-policy 测试通过。最终共享行修改另经类型检查与真实浏览器验证。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
- `public-delivery.log`：Chrome/Firefox × 1440/390 全部通过，最终输入快照未变；截图检查确认移动返回可见及消息行复用。
- `lifecycle-delivery.log`：16 个场景通过，最终输入快照未变。之前失效回执不计入此结论。
- `business-browser-final.log`：完整隔离 Chrome 业务旅程通过；Fake Provider 明确标记，未使用付费 CLI。
- `formal-browser.log`：新启动的真实持久实例通过 Chrome/Firefox 只读页面验收，8 张截图；已读 frontier 可随页面读取变化，canonical 内容未变。

正式 URL：`http://127.0.0.1:4173`。工作开始时此端口没有正式进程，因此本轮是在
idle 检查、完整状态备份及备份验证后恢复启动，不虚构执行过旧 PID 的 graceful stop。
启动使用冻结资产 build `695d33240726a880db9fd333073a4a546a8f024f772b834e0e167b58d45a6172`，
正式浏览器回执确认服务资产版本相同。

`persistent-before.json` 与 `persistent-after.json` 全部摘要相同：6 Room、43 Message、
2 Task、378 Room event、4 Agent/35 revision、RuntimeProfile 历史和37个私有记忆文件保持。
备份位于外部证据目录的 `formal-state-backup`，不把用户持久数据库加入仓库。
没有 commit、push、付费 Provider 执行或 Settings/MCP 改造。

官网原生交互后续被 Mac 锁屏阻断，已提示解锁；正式本地的 headless 真浏览器验收仍完成。
本轮交付的是上述已验证子链路，**不是前六个页面族或完整 Raft 的完成声明**。

## 公开频道继续施工（候选，尚未正式交付）

本轮补齐非成员 Tasks/Files、完整 Principal 作者投影、只读根消息/Thread、个人收藏与
reaction 权限分离。官方新增实操已确认非成员任务看板、任务 Thread 和 Files 空态；
参考频道已重新加入并确认 composer 恢复。没有发送官方消息或启动付费 Provider。

真实浏览器补获并逐项修复：任务卡片错误地把只读导航随写权限禁用、Files tab 刷新丢失、
收藏回跳误入完整 member-only Room。当前继续验证 Thread 中加入后的原位置保留。
前一候选 Chrome/Firefox × 1440/390 通过；其后有修改，不能作为最终冻结版本交付回执。
证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-public-closure`。
`saved-navigation-red.log`、`tab-reload-red.log`、`root-read-red.log`、`chat-task-red.log`
记录各对应失败；候选日志不是最终部署证明。任务状态/权限/原消息仍来自原 owner。

完整公开频道仍不标记完成：最终冻结检查、正式重启及同条件双边范围需在本轮交付段逐项列明。
不进入其他页面族；不以这批通过数量换算全产品完成率。

最终交付状态以[公开频道 surfaces 验收](2026-09-07-public-channel-surfaces-verification.zh-CN.md)为准；上方候选日志保留历史含义，不覆盖最终证据。
