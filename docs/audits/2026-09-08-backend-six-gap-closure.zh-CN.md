# 剩余六组后端差异：施工与验收

2026-09-08。本记录针对 `rah_os` 当前未提交工作树。已完成六组主要后端操作链、整批检查及正式服务备份重启；明确剩余参数与前端入口见下表。

## 已确认来源与适配

八组来自 Raft Computer 1.0.18 的发布源码合同；官方 Web 1.12.0 冻结 bundle 补充行为参数。
源码接口能力已确认，无需重新查完整官网。中央 Server 的数据库、删除副作用、排序算法等没有源码的部分，
以具体可见合同实现并说明本地差异，不伪称官网实操通过。

| 原编号 | 本轮实现                                                                                        | 明确限制                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2      | Task 真删除；Human/Worker/SDK/CLI 同事务，持久重放、不复用编号、已发布文件保留                  | 活动执行/引用冲突明确拒绝；未增加 Web 删除按钮；不声称 Raft Server 也用本地拒绝流程                     |
| 3      | Agent 当前频道 mute/unmute；普通 Activity 抑制、个人提及/DM/关注 Thread 和既有直接责任保留      | 跨目标静音未接；typed Task 直接责任穿透是本地可靠性适配                                                 |
| 4      | Human 评论创建、Worker 读取、原样定位 metadata、回应读取；Agent 显式附件回复与 held 跨 Run 恢复 | 浏览器评论面板/媒体点击定位未做；可选 resolved/resolveAction 未编造                                     |
| 5      | 发送者、时间、排序及目标过滤，默认跨当前已加入 Room 搜索；有界分页                              | 与未知 Raft Server 排序分数不宣称逐项相同                                                               |
| 6      | 已加入 Room/DM/Thread 查询与寻址；签名目标上下文支持显式跨 Room 文本发帖                        | 跨 Room 附件发布、跨目标 held draft 尚明确拒绝；不能算全部参数组合已对齐                                |
| 7      | 公开配置与实际 Run 分开；creator/createdAgents 可见关系、真实服务版本和脱敏 whoami              | 仍缺可信 Computer 展示字段、完整 availability/阻塞原因与生命周期字段；多 Human/中央账户权限不在首版范围 |

第 1、8 项沿用[上一批验收](./2026-09-08-task-amend-upload-capabilities.zh-CN.md)，没有重做。

## 独立审查发现并处理

- Task 删除曾让 Human creator/退群 Agent 收到 Activation，及启动时回填已删除 Task 的旧 obligation：均以复现测试修复。
- 附件评论在已有 Thread 中误建嵌套 Thread、包含 NUL 时读取截断：分别复用所在 Thread、从 canonical 事件 JSON 正文投影；独立反例进入仓库。
- Agent 评论使用明确附件 ID，避免同一 Thread 内不同附件被猜测合并；held draft 保留原评论目标，后续 Run 不能替换。
- 跨目标凭据曾漏掉近期尾窗之外的旧 Thread 正文，以及错误拒绝过期凭据对应的已成功 intent 重放：两个独立反例均已修复并纳入正式测试。

- 浏览器删除断言原等待 5 秒，与既有 5 秒轮询撞线；独立测得 5320 ms 正常消失，属于测试条件问题，未改刷新算法。隔离页面用例在无 Agent 成员的 Room 验证闲置 Task 删除，活动执行拒绝由后端测试覆盖。

## 分层验收

- `npm run check` exit 0：后端 1116 项中 1111 通过、5 项付费 gate 跳过；Web 383、历史合同回归 34、浏览器请求策略 12、双边截图证据规则 3 项通过，类型/仓库身份/UI 合同检查通过。
- `npm run format:check`、`git diff --check` 通过。第一轮检查发现 Core Human facade 白名单漏登记三个新增公开方法，明确补齐后整批重跑通过，未放宽权限断言。
- `npm run build:web:workbench` 通过，正式冻结 Web build 为 `a9c8db593bba20ab804289e293a8df1576e059ba3d97d6ce6a8505ddb2ac311f`。构建保留已有大 chunk 提示，没有据此宣称性能全面验收。
- Chrome/Firefox 隔离真实 daemon 页面通过：API 真删除后全局卡片消失，刷新后等待原有数据加载再确认不存在；评论、anchor 原样持久化，既有 Thread 刷新后仍展示正文。浏览器无 pageerror。此 gate 未新增或伪造 Web 删除按钮/媒体评论面板。
- Firefox 持久工作台 gate 在 1440×1000 和 390×844 通过。
- 正式服务已先确认空闲、备份并校验，再将旧 PID 62026 优雅停止，新 PID 94789 在 `http://127.0.0.1:4173` 启动。备份为 `/Users/sun/.rah/backups/pre-restart-faab186d-2917-47bc-9bb9-08bf707d0993`。
- 重启前后 6 个 Room、43 条消息、404 个 Room 事件、2 个 Task、4 个 Agent 的配置与版本、runtime 配置、37 个私有记忆文件及工作台配置的数量和 SHA-256 全部一致；未清理用户历史。
- 正式新页面 Firefox 在 1440×900 与 390×844、DPR 2 下通过：Computer、Task 详情/历史/重载及 Search；读取的 build ID 与冻结资产一致，无页面错误或被拒请求。已检查截图。此为正式本地验收，不代表本批已做官网同条件比较。
  未运行付费模型测试，未提交或推送 Git。未进行本批官网写操作双边验收。

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-backend-six-gap-closure/`。
Task 删除专项：`/Users/sun/Code/reviews/rah_os/2026-09-08-backend-eight-gap-closure/task-delete/`。
跨目标搜索与发送专项：`/Users/sun/Code/reviews/rah_os/2026-09-08-backend-gap-closure/cross-room-search/closure.zh-CN.md`。
静音/资料专项：`/Users/sun/Code/reviews/rah_os/2026-09-08-remaining-six/`。

## 未对齐项必须保留

本批不以“新增接口可调用”替代完整复刻：

- 当前频道静音已实现，其他已加入频道的静音目标参数仍未接入。
- 跨 Room 文本与明确 Thread/DM 发送有独立上下文凭据；跨 Room 附件预约/发布、跨目标暂存草稿仍拒绝。
- 公开资料仍缺可信 Computer name/hostname/os/description，完整 availability/blocked 原因、部分生命周期/executionMode 字段及 createdAgents 的逐子 Agent runtime 和续页；不以 enabled/配置值伪造实际运行。
- 评论 backend 有创建/读取/Agent 明确回复与 anchor 保存；Web 面板、点击定位，以及未知可选 resolve 语义不在本批通过项中。
- Task 删除后端可调用不代表官网存在已确认的可见删除入口；入口待证，见下方术语纠正。

以上是明确剩余差异，不合并进多 Human、远程 Computer、大文件流式等已延期范围，也不宣称 8/8 完整对齐。

## 术语与证据边界纠正（用户追问后复核）

- 跨目标静音指 Agent 在当前 Room 执行时，指定另一个自己已加入的频道抑制普通 Activity。Raft `/channels/:channelId/mute` 明确有目标参数；不是新增用户或远程计算机功能。
- 跨 Room 附件指当前执行中的 Agent 把文件发布到另一已加入 Room。已有跨目标文本发送不代表对应文件预约、发布权限已接齐。
- 跨目标 held draft 是 RAH 因新事实暂停发送、保存原意图后恢复的本地并发流程；不能把它直接称为 Raft 的独立产品功能。应作为本地跨目标发送一致性边界管理，是否需要扩展沿现有 owner 决定。
- 资料字段差异指 Worker API 尚未取得现有 Computer/Agent owner 的部分资料，不表示 Computer 页面本身缺少机器名或 OS，也不要求新建资料页。
- Task 删除已确认 Raft Computer API，以及冻结 Web bundle 的 `deleteTask` store action、`qK` 投影移除和删除文案。本次检索没有找到该 action 的可见组件调用链；因此 **Web 删除入口改列待证，不是已确认缺失按钮**。不能仅凭 store action 或文案添加生产按钮。
- 附件定位入口有明确前端调用链：冻结 `index-BVfbaScj.js` 的 `Lw` 评论列表将有 anchor 的评论渲染为 button，点击调用 `Q8e`；该函数对 lines/csv-rows/md-section 滚动并闪亮标记，对 html-region/video-timestamp 调用相应查看器。此处指附件内部位置，不是磁盘路径、Finder 或大文件流式。证据是冻结源码，本批没有官网实操验收。
