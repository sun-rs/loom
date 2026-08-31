# Tasks / Search / Activity：交互对齐与交付审计

日期：2026-08-30。范围是上一批全局 Tasks/Search/Activity，不代表所有产品模块、所有弹窗和 Raft 全功能已 100% 复刻。

## 结论与来源

本批完成共享筛选/状态弹层、Search 范围与排序、跨 Room 任务拖拽及真实浏览器业务验证。正式服务启动结果见下文；不能用隔离测试页冒充用户的持久工作台。

设计先于施工：[交互计划](../product/global-discovery-interaction-plan.zh-CN.md)。

授权的 Raft 发布 bundle：`../raft-ui/vendor/raft/index-WTraJnrd.js`，SHA-256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。

| 部分                                | 采用方式与边界                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Zd` / `V9e`                        | 移植弹层结构、宽度/偏移/选项高度、选中/hover/关闭语义，使用共享 React owner，不运行整个第三方 bundle              |
| `HG`                                | Tasks 多选；“我创建的”“分配给我的”置顶，后者之后是“未分配”                                                        |
| `RN` / `MN` / `uat` / `mat` / `fat` | TypeScript 移植范围归一、发送者冲突处理、时间选项和排序缺省规则；`user` 适配 canonical `human`                    |
| `Ytt` / `Wtt` / `Vie`               | 卡片与状态弹层规格；复用同款 dnd-kit，Mouse 5px、Touch 200ms/5px；加上键盘入口                                    |
| 图标                                | CalendarRange、Bot、GripVertical、CircleUserRound 和 X 路径取自发布代码/实际 DOM，新增独立 sprite；未篡改冻结快照 |
| 搜索相关度                          | Raft 服务端 ranker 不在发布包。RAH 为自己的确定性精确/前缀/包含排序，不能声称服务器算法逐字复制                   |
| Task 状态写入                       | 保留 Kernel 和 ADR-0021/0022 的审阅/终止保护；不移植上游任意状态转换许可                                          |

新增图标 sprite SHA-256：`485429009dd17966f0f00494f4a87f40f7c016e011b76b847ceb15533b651629`。目录人物数据没有完整头像字段的地方仍用来源明确的通用图标，不声称头像内容相同。

## 本批修复

- 全局 Tasks 的频道/创建者/负责人筛选、状态菜单，Search 的发送者/范围/频道/时间/排序，以及 Room Tasks 筛选共用弹层组件。包含搜索无匹配、清除、禁用、单选关闭、多选保持打开、外点/失焦关闭、Esc 与焦点返回。
- 纠正范围含义：`@我 / 人类 / Agent`，而不是把频道/私聊/线程误当成官方范围。人类与 Agent 同选抵消类型限制；发送者与类型冲突时清掉冲突值。
- 空关键词但有筛选时可查消息；无关键词时相关度不可选，采用时间顺序。非空查询缺省相关度，可切换最新；中文 IME 未完成时不发起半成品查询。
- 同查询刷新失败保留已显示结果；换查询取消旧请求。服务器仍负责 ACL、过滤、排序、游标冻结和变更绑定，不把消息历史放进 localStorage。
- 真实浏览器发现并修复 Tasks 多频道参数泄漏到 Search：界面只有一个 chip，后台却携带第二个频道。现在跨 surface 清理过滤，Search 链接频道/发送者归一为单值，Tasks 仍允许多选。
- 状态菜单和全局拖拽共用 Task action owner，写入前同步目标 Task 自己的 Room；旧卡片与服务端状态、负责人或时间戳不同则拒绝。取消要填写原因；完成需已有提交/审阅证据；不乐观伪造成功。
- 修复菜单累计横向偏移：前置图标 14px、chevron 12px，而非统一 14px。Search 顶部图标改为来源的 36px、水平 padding 20px；频道 chip 32px 高、12px 字体、独立小图标和 2px 阴影。

## 双边真实浏览器证据

官方为已登录 `app.raft.build` 页面；本地为隔离真实 daemon + SQLite + Fake Worker 的 `127.0.0.1:4189`。官方侧只读打开控件，没有修改真实任务。本地业务数据通过浏览器创建/操作。

两边桌面视口均实际检查 `innerWidth=1440, innerHeight=1000`。过程中发现新建 tab 未继承 viewport，曾为 1049×1172，已纠正并重新测量关键项目；不把该次作为同尺寸证据。

范围弹层两侧均为 `x=194, y=114, width=220, height=144`；选项 216×36；12px/16px、700 字重；hover computed color 均为 `oklab(0.88289 -0.00532487 0.162183 / 0.3)`；阴影使用 Raft 的 `#141111` 4px 规格。

| 实际操作                                                                   | 结果                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 创建 Human-only 的 Interaction Audit Room，发送 3 条排序探针               | canonical 消息持久化；无 Agent 调用                                       |
| 默认相关度 / 最新切换                                                      | 精确→前缀→包含；最新顺序反转，与实际写入时间一致                          |
| 130 条历史查询，连续翻页                                                   | 50 / 50 / 30，最后下一页禁用；没有重复/跳页                               |
| 发送者“我”后选择 Agent 范围                                                | 清除不相容发送者；结果和 URL 同步                                         |
| Tasks 两频道多选→Search                                                    | 不再留下不可见频道过滤；菜单多选不提前关闭                                |
| Esc 退出范围菜单                                                           | 菜单关闭，焦点返回范围按钮                                                |
| 搜索不存在的弹层选项                                                       | 显示没有匹配项，不残留旧选择行                                            |
| 在另一 Room 打开 Global Tasks，拖动 Interaction Audit 的任务到关闭         | 打开原因对话框；空原因不能提交；确认后 canonical cancelled，刷新仍保留    |
| 已关闭任务通过状态菜单重开                                                 | canonical todo；没有改写当前页面所在的另一 Room                           |
| 未执行任务拖到进行中                                                       | 明确拒绝，不假装 Agent 已经执行；卡片留在待办                             |
| Keyboard Space / ArrowRight / Esc                                          | 可进入拖拽并取消，任务状态不变                                            |
| Agent Council 创建任务，Fake Worker 认领并提交，Human 在 Global Tasks 完成 | 实际经过 Task command / Room reply / review 证据，结果 completed          |
| Activity 将 Interaction Audit 标为已处理，刷新                             | 该 Activity 消失；不把关联 Task 错误完成                                  |
| 390×844                                                                    | 页面宽度 390，无页面横向溢出，弹层不越界；全新 Tasks 默认列表             |
| 新建干净浏览器页                                                           | console error 为 0；旧 dev tab 的 HMR hook 依赖长度警告不计作生产成功证据 |

Fake Worker 的两条实际 canonical 回复是 `Fake Worker verified the daemon Task command path` 和 `Fake Worker completed the durable Task protocol`。这证明业务链和真实进程/数据库交互，不证明本轮真实付费模型的理解能力；本轮没有付费 CLI 调用，也没有新做 Firefox 或真机 iOS 验收。

截图（内容不同，不用全屏像素百分比掩盖差异）：

- [官方范围弹层 1440](./evidence/2026-08-30-discovery-interactions/raft-scope-1440.png)
- [本地范围弹层 1440](./evidence/2026-08-30-discovery-interactions/local-scope-1440.png)
- [本地创建者菜单和全局看板](./evidence/2026-08-30-discovery-interactions/local-tasks-creator-1440.png)
- [390 Tasks](./evidence/2026-08-30-discovery-interactions/local-tasks-mobile-390.png)
- [390 Search](./evidence/2026-08-30-discovery-interactions/local-search-mobile-390.png)

## 正式启动时额外发现的缺陷

实际持久库第一次启动报 `RuntimeOffer local-workbench-offer-codex already belongs to another Host or profile revision`：旧 runner 固定 Offer ID，但内置 Worker prompt/manifest 已使 Profile 升级。不是页面离线占位问题。

修复 owner：`packages/daemon/src/local-workbench-runtime-bindings.ts`，合同见 [ADR-0017](../adr/0017-persistent-loopback-local-workbench.md)。为新 Profile 修订生成新 Offer，精确迁移本地 Workspace 策略引用，不删除旧 Offer，不弱化 Kernel 校验，不重建 Agent，不改变模型、effort、人设或记忆引用。

新增测试先复现同一个 ID 被复用，再验证历史保留、旧 ID 仍拒绝新版覆盖、新 Offer 发布成功、重复启动无重复迁移。自动模型探测不等于自动发送工作。

正式库根是 `/Users/sun/Library/Application Support/RAH OS/state`。启动前确认无运行者并用 SQLite backup API 备份到同级 `pre-discovery-ui-KIflm6` 私有目录；凭据不复制到浏览器或报告。保留原 workbench metadata，原有两 Room；该库本来没有聊天消息，不伪称恢复了 fixture 对话。

## 门禁与正式入口

- `npm run check`：TypeScript 通过；657 项包测试中 655 通过、2 个付费 CLI gate 跳过；37 项 Web 测试全部通过。
- `npm run format:check`、`git diff --check` 通过；`npm audit --omit=dev` 为 0 vulnerabilities；production build 通过。
- 最终性能样本：2,000 条消息的 Activity + Search 查询 18.9ms；1,200 回复的 unfollowed Activity 4.7ms（本机测试，不是跨设备承诺）。
- 较早一轮出现与本批无关的 `slot launcher executes only K slot bytes...` 测试失败；未改其代码，单独复跑以及最终完整门禁均通过。不将其第一次失败隐去，也不臆断已修好潜在 flaky 根因。
- 正式入口：[本机 RAH OS](http://127.0.0.1:4173)。`/_rah/health` 返回 `{"service":"rah-os-local-core","state":"online"}`，并核实 loopback 4173 存在实际监听进程。
- 生产浏览器实际打开首页、全局 Tasks/负责人菜单、Search/范围菜单、Computer 和 Agent 资料目录。Computer 显示 4 个可运行 Offer、4 个在线绑定：Codex 0.149.1、Kimi 0.38.0、OpenCode 1.18.22、Claude 2.1.234；没有 token 输入页；新生产 tab console error 为 0。
- 发布 bundle：`mount-app-h2PUs-76.js`，SHA-256 `b8099d28c2d00e8ed5e0a3feafe0c45d8086a5b8dd32dc851caec76712cd73f9`。
- [生产 Computer 截图](./evidence/2026-08-30-discovery-interactions/production-computer-1440.png)。数据库只读检查确认旧 Offer 与新 revision-bound Offer 同时保留、Host 在线、未向正式库写入测试消息。

该入口使用持久数据库和真实本机运行时，不是 Vite fixture；4189 测试实例在验收后退出。当前为本机 loopback 服务，没有新增 LAN 暴露或 LaunchAgent 自动启动，未动旧 `rah` 的 LaunchAgent。下一次手动启动可在 `rah_os` 使用 `npm run start:local-workbench`。

## 收口边界

本批 UI/交互可以验收，不等于 Raft 全部模块 1:1。以下是明确边界：

1. Search 服务端相关度未取得上游源码，字面搜索不是语义/模糊搜索。
2. 任务拖拽保留安全约束；不能把未经执行/审阅的任务直接拖成完成。全局卡片未新增负责人改派入口。
3. 未扩展 Files、远程 Computer、通知系统的所有弹层；也未重测整个 Agent 管理和全部真实 CLI。
4. 大屏已核对，390 是浏览器响应式检查，不是 iOS 原生/PWA 真机签收。
5. production Web build 存在大于 500kB chunk 的构建警告，主应用仍约 1.04MB（gzip 303kB），不是已完成的包体优化。
6. 本次是 source-checkout 持久工作台运行，不是新发布公证 macOS 安装包或自动更新服务。
