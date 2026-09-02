# Raft ↔ RAH OS 全站行为合同与双边差异主审报告

审计日期：2026-09-01。代码基线：`f9b271c` 加其后的既有未提交工作树。本文是只读审计，不是修复交付、发布记录或完成证明。

## 1. 最终裁决

**现在不能宣称 RAH OS 的核心功能页面、鼠标行为、点击交互、前后端语义或正式产品与 Raft 官网一致，也不能宣称已经收口。**

最先阻断交付的不是像素差，而是正式地址 `http://127.0.0.1:4173` 当前没有可用后端：页面显示 `Workspace 0 / Channel 0 / DM 0` 和 `Failed to fetch`，重新连接后进入空 Human PAT 认证门。隔离的 `4196` Fake CLI fixture 可以证明当前源码中的局部 UI 和协议路径，但不能替代正式部署、真实 Provider 或持久数据证据。

在 fixture 中，基础框架、Thread、Task、头像 hover/click、姓名插入 `@`、Search、Agent Workspace 文件树等局部行为已经接近或通过；但 Channel/DM 侧栏持续 disabled、普通消息 hover 缺回应与收藏、Room 偏好 disabled、Agent 提醒/应用仍未接、Agent Chat/MCP 语义与 Raft 不同、Computer 仍是单机只读投影。这些是核心产品差距，不是装饰性差距。

## 2. 审计方法与证据边界

本轮由三名独立审计 Agent 分工，主审随后复核截图、文档和冲突项：

1. 官方合同审计：冻结官方发布包 `index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`，追踪触发位置、源码组件/参数、数据来源、关闭与键盘行为。
2. 双边浏览器审计：Raft 官网、正式 `4173`、隔离 Fake CLI `4196`；桌面 `1440×1000`，本地另做 `390×844`。没有发送官网消息、修改设置、启动 Agent 或调用真实 Provider。
3. 本地映射审计：检查 Web → typed SDK/application service → Kernel/daemon owner，运行35项针对性自动测试，35通过；自动测试只记为 `A`。
4. 主审：抽查正式失败、官网三键消息 hover、本地单键 hover、双方 Room 设置等原始截图；纠正旧指南中 switcher、收藏/置顶、权限编辑和状态点的过时结论。

证据采用五级且禁止跨级推断：

- `C`：代码或 owner 存在。
- `A`：自动测试通过。
- `L`：本地真实浏览器通过，fixture 必须显式标注。
- `R`：Raft 与本地在相同前置条件下得到等价结果。
- `D`：当前正式部署通过。

`C` 不能推导 `A/L`，fixture 的 `L` 不能推导 `D`，双方各自成功但数据前置不同也不能记为 `R`。

## 3. 正式部署 P0

| 项目          | 当前事实                                                         | 裁决                 |
| ------------- | ---------------------------------------------------------------- | -------------------- |
| `4173` 初始页 | 旧壳可加载，业务数据为0并显示 `Failed to fetch`                  | `D-fail`             |
| 重新连接      | 落到 Human PAT 页面；输入为空、提交 disabled                     | `D-fail`             |
| daemon/端口   | 本轮根审与独立审计均未发现监听                                   | `D-fail`             |
| `4196`        | 审计时启动的当前源码 Fake CLI fixture 可操作；取证后已停止       | 只能算 `L-fixture`   |
| 可复现性      | 44个 tracked 修改、53个 untracked；仅 `f9b271c` 不能复现当前页面 | 发布与审计基线未冻结 |

证据：[正式 Failed to fetch](/tmp/rah-os-browser-audit-20260901/L00-formal-4173-failed-fetch.png)、[重连认证门](/tmp/rah-os-browser-audit-20260901/L01-reconnect-auth-gate.png)。

## 4. 全面双边矩阵

| 模块/行为         | Raft 官网合同                                                                                  | RAH OS 当前证据                                                          | 差距与前后端归属                                                             | 裁决                       |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------- |
| Desktop shell     | 黄 rail、浅色 sidebar、粗黑边框、粉选中；约62px rail/303px sidebar                             | 4196 基础几何接近                                                        | 字体/细节仍需逐页视觉回归；正式不可用                                        | `R-partial`, `D-fail`      |
| 空间标识/switcher | **点击**标识打开 anchored 菜单；多空间、排序、加入/创建；Escape关闭并还焦点；记忆各空间最近URL | 本地是空间目录/身份 dialog                                               | 前端组件与状态模型不同；多空间/切换后端产品合同不全                          | `R-fail`                   |
| Chat sidebar      | Saved/Pinned/Joint/Channel/DM；Manual/Recent/A-Z；拖拽/置顶                                    | 代码与自动测试存在；4196 Channel、DM、拖拽包装与按钮持续 disabled        | UI capability projection/权限门错误；正式阻塞                                | `L-fail`                   |
| Channel/DM 选择   | 条目可选并恢复最近URL                                                                          | 只能从替代入口打开 Alice DM，sidebar 条目不可点击                        | 前端 enabled 条件；DM业务主链未在正式环境验证                                | `R-fail`                   |
| Composer          | Enter发送，Shift+Enter换行；空Enter不发送                                                      | 4196 DM/Thread同样通过；未发送付费请求                                   | 核心键盘合同接近，正式/真实Provider未证                                      | `R-partial`                |
| Thread            | 打开正文/回复；桌面 Thread 与 Task detail 的 Escape 合同不同                                   | 4196 Task Thread与Activity目标可开                                       | 双方关闭后焦点都落到body；本地仍需区分各容器关闭合同                         | `R-partial`                |
| Task              | Channel Task、全局过滤/列表/看板、详情                                                         | 4196两条Task、频道/全局视图可开                                          | `task.unblock`后端无UI；状态列/完整生命周期未齐；正式阻塞                    | `R-partial`                |
| 消息 hover        | reply/reaction/save 三键；粗指针不显示hover工具栏                                              | 4196普通和Task消息只出现Thread                                           | 代码 owner 存在但当前浏览器投影失败；回应/收藏按钮与picker/菜单前端缺口      | `R-fail`                   |
| Reaction          | 7个快捷 emoji：👍 ❤️ 🎉 👀 🔥 😂 ✅；Escape还焦点；共享注解                                    | 本地Kernel/SDK代码存在，4196入口未出现                                   | 不能把代码或单测算UI交付；完整picker/人员hover仍缺                           | `L-fail`                   |
| Saved             | 私人收藏；查询/频道/排序；复制链接/内容/移除；无限加载                                         | 本地有收藏owner和列表，但普通消息入口未出现                              | 筛选、菜单、总数、加载与正式持久化未完成同前置验收                           | `R-fail`                   |
| 消息身份          | 姓名点击插入`@`；头像hover摘要；头像click打开右栏默认Activity                                  | 4196三项均通过，Escape后能还头像焦点                                     | 结构接近；状态数据与真实Provider仍未同前置                                   | `R-partial/pass-structure` |
| Room设置/成员     | 成员二级页、添加；名称/描述；pin/mute/collapse；private/archive/leave/stop/delete              | 4196设置/成员/Escape可用，pin/mute/collapse disabled，布局与可见性块不同 | 前端偏好入口与部分Room生命周期；归档/删除后端合同不全                        | `R-partial/fail-controls`  |
| Agent目录/资料    | 目录默认Agent；资料字段与runtime/model/effort入口                                              | 4196默认Alice资料，配置modal可开但只做取消验证                           | 保存操作未双边；role编辑UI缺；tab URL恢复不全                                | `R-partial`                |
| Agent 7 tabs      | Activity/Profile/Chat/Reminders/Workspace/Apps/MCP                                             | 七tab存在                                                                | Reminders/Apps明确“协议未接入”；MCP仅per-call元数据；Chat语义不同            | `R-fail`                   |
| Agent Chat        | Agent-to-Agent conversation                                                                    | 本地是Human可见的普通Room/DM                                             | 不是文案差异，是对象模型、ACL与路由语义差异                                  | `R-fail`                   |
| Agent Activity    | 跨Room/DM的trajectory，部分诊断受manage/creator权限控制                                        | 本地有trajectory owner，fixture有数据                                    | 新真实CLI、正式环境与权限边界未复验                                          | `R-partial`                |
| Agent Workspace   | Agent私有工作区树、预览、刷新等                                                                | 4196非空树、隐藏文件、安全文本预览、resize、移动端通过                   | 官网Computer离线导致非空树失败，不能做`R`；本地隐藏文件切换清状态            | `L-pass`, `R-blocked`      |
| Room Files        | list/download/preview；与Agent Workspace不同                                                   | 双方当前Room Files均为空态                                               | 非空成功、Thread/Task附件、Artifact、Finder reveal、完整预览未证/未齐        | `R-empty-only`             |
| Search            | loaded实体搜索；历史消息延迟调用`/messages/search`；Escape还到来源                             | 4196搜索Alice返回Room/Agent                                              | 排序/相关度算法与历史消息同数据未双边                                        | `R-partial`                |
| Activity          | all/unread/mentions；mark-all；done/restore；Thread/Task目标                                   | 4196列表与目标Thread可开，无同类未读种子                                 | 未读状态机未同前置；打开不等于read                                           | `R-partial`                |
| Notifications     | 生成事项中心（套餐、Computer、PWA等）；与InputRequest分离                                      | 双方只开空中心；本地另有InputRequest/系统观测                            | badge、非空分类、dismiss/read未验证；不能把InputRequest resolve复用成dismiss | `R-empty-only`             |
| 状态点            | Chat unread、Activity unread、Computer attention、Computer connectivity独立                    | 本地当前种子只有部分在线绿色                                             | 本地粉点重现、灰色离线、升级/legacy均未同前置                                | `R-unverified`             |
| Computer          | 列表/离线/升级/legacy、运行时、Agent、恢复命令与动作                                           | 4196单台在线Computer详情；默认自动选第一台                               | 仅单机只读；无远程/多机/恢复/restart/upgrade；官网直接路由有自身空选择bug    | `R-fail/partial`           |
| Settings          | 多类个人、通知、资源与管理设置                                                                 | 主要只有Managed MCP/LAN，其余多disabled                                  | 前端入口和后端owner均缺；账户/收费明确排除                                   | `R-fail`                   |
| Long history      | 分页、冻结游标、锚点、长消息折叠                                                               | 有源码/自动化/旧fixture证据                                              | 当前正式与官网同前置大历史未跑                                               | `C/A`, not `R/D`           |
| 390×844           | PWA共享行为路径                                                                                | 4196 Chat、drawer、Agent列表、Workspace预览部分通过                      | Channel/DM仍disabled；官网同前置移动审计未做                                 | `L-partial`                |

## 5. 鼠标、点击、键盘和焦点结论

### 已验证接近或通过

- 姓名点击将 `@Agent ` 插入 composer，未发送。
- 头像 hover 显示摘要，头像 click 打开右侧详情并默认进入 Activity。
- Agent 详情 Escape 在本地可恢复先前 Thread 并把焦点还给头像。
- 本地 sidebar 与文件树 splitter 支持 pointer drag 和键盘箭头 resize。
- 本地 Workspace 刷新可保留已展开目录、选中项与预览；复制路径有短暂反馈。
- Enter/Shift+Enter 规则在双方 DM/Thread 的只读清稿实验中一致。

### 明确失败或不同

- 普通消息 hover：官网三键，本地当前只出现Thread。
- Chat sidebar：本地条目和拖拽包装为disabled，无法完成点击/拖拽同操作。
- Room设置：官网偏好可操作，本地对应开关disabled。
- 空间菜单：旧指南错写为hover；实际官网为click anchored，本地是dialog。
- Thread关闭：双方都没有把焦点还给触发按钮；这是共同可访问性缺陷，不应因官网也有就忽略。
- 本地切换“显示隐藏文件”会折叠目录并清除选择/预览；普通刷新本身可保留。

### 仍未验证

- 官网真实拖拽/排序/置顶写入、反应写入、收藏持久化、Agent字段和模型保存。
- Firefox、粗指针完整分支、官网390同前置全量页。
- hover离开延迟、所有popover嵌套关闭、全站焦点回归尚未形成穷举测试。

## 6. 粉点、灰点和通知语义

不得按颜色做统一状态枚举。官方源码和浏览器至少确认四个独立owner：

1. Chat unread：频道/DM未读；当前会话只是视觉隐藏，不自动改变持久状态。
2. Activity unread：个人Activity未读；进入页面粉点消失，离开后原位置重现，证明“选中隐藏”不等于read/done。
3. Computer attention：rail粉点，可能来自offline、outdated upgrade或legacy。
4. Computer connectivity：列表头像灰点代表offline；与rail attention不同。

本轮官网粉点测得约10×10、`rgb(254, 125, 168)`；离线灰点约10×10、`oklch(0.707 0.022 261.325)`。这些测量只能约束表现，业务语义必须来自各自owner。4196没有相同未读/离线种子，所以本地语义仍是`unverified`。

## 7. 前后端缺口排序

### P0：先恢复可交付基线

1. 启动并验证正式daemon/4173，冻结可复现commit/build/配置身份；不能再用fixture代替正式版。
2. 在正式版跑Channel→DM→Thread→Task→Agent→Search/Activity→Files→Computer最小业务链，记录真实Provider与持久化结果。
3. 清理或正式提交当前大规模dirty worktree，确保报告中的页面能从一个明确revision重建。

### P1：核心产品差距

1. 修复Chat sidebar capability projection，使Channel/DM点击、排序、置顶和拖拽在真实浏览器可用。
2. 让消息三键toolbar实际投影到普通消息；完成Raft七emoji picker、共享回应、私人收藏与菜单/筛选/深链的端到端持久化。
3. 接通Room pin/mute/collapse和完整生命周期；补Human/Room角色编辑UI，但不扩张ACL。
4. 对齐Agent tab语义：Agent-to-Agent Chat、Reminders、Apps grant、MCP server/tool分组；完成role与tab URL恢复。
5. 用相同种子验证四类状态点、Activity read/done、Notifications dismiss与InputRequest resolve的分离。
6. 完成Computer多机/远程只读到管理的授权产品合同，再接恢复/restart/upgrade；不复制Raft中央账户拓扑。
7. 完成非空Room Files、Thread/Task附件、Artifact发布、预览与平台reveal替代。

### P2：完整性与可访问性

1. Thread关闭焦点恢复、hover延迟、所有popover/menu键盘环和粗指针分支。
2. 消息编辑/删除、完整reaction人员预览、Saved加载/右键菜单/总数。
3. Room归档/删除/离开/stop的完整失败与权限分支；Agent restart/session/reset与external Agent创建。
4. Search完整相关度/分页/错误，Activity所有筛选，OS/browser push和Settings剩余面。
5. 非空长历史、Firefox、390官网同前置、真实Host离线/恢复、真实Provider全状态回归。

## 8. 不属于缺口的明确边界

- RAH OS 不负责安装或登录Codex/Claude/Kimi/OpenCode CLI；用户管理本机CLI账户，RAH OS只发现、调用和管理。
- 不复制Raft中央账户、billing、强制中央server路由；本地daemon是事实owner，未来remote Computer通过本地协议扩展。
- 不复制官网已观察到的缺陷，例如`/computers`空选择文案“选择一个频道”或Thread关闭不还焦点。
- UI合同可以复用，后台实现不必复制中央服务拓扑；但本地替代实现必须产生相同的用户可见结果、权限和持久化语义，才能记为`R`。

## 9. 行为指南覆盖度审计

- 74项旧intent已经逐项登记，但它不是完成率，也没有覆盖所有hover、focus、状态点、Agent七tab、Files与错误态。
- 当前官方发布包有1,836个回调候选；已建立的来源关联只覆盖少量Agent合同和23个回调，另有13个动态引用尚未分类。不能宣称“已经从网页源码总结全部逻辑”。
- 前端源码能高可信地给出触发、请求shape、响应显示、条件渲染、键盘与关闭行为；不能单独证明服务端事务、ACL、持久化、CLI副作用和失败恢复。
- 本轮已经纠正空间菜单、消息收藏/置顶当前实现状态、成员权限编辑、Computer默认选择、通知/InputRequest分离和状态点owner。后续每条合同都必须带源码位置、数据前置、浏览器步骤和`C/A/L/R/D`结果。

## 10. 主审复核与保留意见

主审接受三路报告的共同事实，并对以下冲突作了裁决：

- “代码已有回应/收藏”与“浏览器没有按钮”不冲突：前者是`C/A`，后者证明当前`L`失败，最终按失败记录。
- “正式版此前已部署”与本轮结果冲突：当前实测优先，`4173`记为`D-fail`。
- 官网Computer直接路由不选第一台与本地默认第一台不同，但官网同时出现错误频道文案；这不是应机械复制的目标。
- 官网Agent Workspace失败来自离线Computer，本地非空树成功；前置不同，只能记本地`L-pass`和双边`R-blocked`。
- Raft提醒/Apps/MCP当前可能为空不等于静态占位；源码有查询能力，而本地明确写“协议未接入”，因此仍是产品缺口。

本轮没有修改生产代码、没有提交、没有重启正式服务、没有调用付费CLI，也没有对官网执行业务写操作。隔离审计 fixture 在取证后已经停止。浏览器证据目录为`/tmp/rah-os-browser-audit-20260901/`，属于当前机器临时证据；长期事实以本报告和行为指南为准。
