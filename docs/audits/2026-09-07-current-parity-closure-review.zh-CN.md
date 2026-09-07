# 最新代码事实与逐环节收口计划

范围更新（2026-09-07，用户后续决定）：本报告保留实现/测试历史；其中公开频道优先收口、
暂停其他主线施工的要求已撤销。多 Human 功能整体延期，按
[单 Human 主线决定](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)继续推进。
延期不代表公开频道完整复刻通过。

2026-09-07 续修更正：下表是本轮施工前快照。Human 公共阅读、预览/加入和离开后关注
已有新候选；媒体/文件双入口此前已交付。最新变化与限制见
[连续施工记录](./2026-09-07-pre-settings-continuation.zh-CN.md)。

本次审查范围：独立 `rah_os` 当前工作树；包含上一批公开频道后端增量及此前未提交内容。
不以旧 `rah`、旧计划或登记标签推断实现。以代码 owner、实际 UI 接线与有日期的证据交叉判断。
本文件是当前证据解释，不创建第二套状态库；行为状态继续由 ui-behavior-registry.json 维护。

## 结论

Room → Inbox → Activation → AgentHost → RunAttempt → 显式行动已有实现；
Task/Review、冻结 Submission、Search、reaction/bookmark、附件、独立 Agent 文件记忆均有 owner。
不再重建这些后端。Raft 未公开服务端无法声称逐行或内部算法完美复刻；目标是授权固定版本
可观察的 UI、交互、对象语义与业务结果一致，内部以本地 Room-first 合同实现。

目前缺口不止早期五项，也不能把所有“待验收”当成“未实现”。

| 环节                   | 最新事实                                                                                                                                                                                                     | 尚未收口                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 公开频道发现/阅读/加入 | public-channel.ts、Human port 和 SDK 已有元数据目录与本人 member 加入；global-discovery.ts / human-navigation.ts / collaboration-service.ts / room-files.ts 仍限成员读取；Web Search 仍直接打开已有可读 Room | 非成员正文、Search/定位/附件统一权限、前端预览/加入/发送与失权清屏；退出后 Thread 关注另需独立完整合同。不能宣称已有 API 就完成 B016           |
| Room 日常工作流        | leave/delete 迟到回执导航保护已有双浏览器证据；SOS、创建、归档、设置、置顶排序已有生产动作                                                                                                                   | 创建/归档/设置冲突/SOS 恢复/侧栏草稿等按各行为分状态验收。已通过的生命周期场景不重写                                                           |
| 文件交付               | FileUploadStore、ComposerFiles、RoomFiles 已有选择、准备、上传、发送引用和读取；Chat/Thread 共享拖放入口已交付                                                                                               | B019 拖放本地链路已有证据，媒体/文件双入口和官网现场对照仍待补齐；文件菜单全集、复杂类型/大文件预览属于 B021/B022，不能借本批一并声称完成      |
| Human/Agent 页面       | HumanProfiles、目录角色刷新、DM 与资料接线已实现；Agent 多 tab、执行 reset/pause 等已有能力                                                                                                                  | 多 Human 邀请/全空间移除没有完整本地身份生命周期；Agent Activity/Reminder/Workspace 内容及非空/失败/权限组合仍需逐项验收。tab 存在不是正文完成 |
| Computer               | workspace-catalog-panes.tsx 已接 Agent 跳转、runtime inspector、doctor 复制；resident/replacement owner 已存在                                                                                               | 正式本机恢复指导、Human 管理入口到最终结果；旧 splitter 仍有页面自持 pointer handlers。远程注册按钮禁用不应成为当前单机调度新工程              |
| Settings/MCP/帮助      | 账户/资料/通知偏好已有；settings-pages.tsx 翻译/时区部分禁用，Docs 仅展示仓库路径；MCP 管理依赖已配置 executor                                                                                               | 本地适用正文、可操作帮助入口、首次 executor/secret 配置闭环；翻译与 onboarding 须先裁决，不能伪造可用开关                                      |
| 通知与设备             | 持久通知、typed click、dismiss、hover/focus 已有实现和局部证据                                                                                                                                               | 非空 InputRequest/dismiss/新版本重现与逐入口回跳，以及 macOS/iOS 真机横幅/点击。服务端 delivered 不证明设备呈现                                |
| 全站视觉/长期运行      | 内部 tokens/ui-web 与来源登记、分页/GC/fence 已有；历史/任务虚拟窗口有局部回归                                                                                                                               | 官方同条件完整行为覆盖仍不齐；当前候选长时间 soak、开机恢复、真实 CLI 组合与设备发布证据不能由单元测试代替                                     |

旧 Human“双粉色选中”经解锁后的实际点击核查为 hover，不作为代码缺陷继续施工。
中央账户、计费、订阅、市场、互联网 relay 和远程文件传输不计入本地首期缺口。

## 本轮新增的 Computer 源码交叉审查

已实际读取 Raft Computer 1.0.18 提取物（main.js SHA-256
20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e），
来源目录 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices`。
其中 shared/src/attachmentUploadContract.ts 145–199 行定义 server-authoritative
upload limits、创建/验证完成/取消/状态；shared/src/agentApiContract.ts 定义消息、频道、
任务和 Reminder 的业务合同。computer/src/apiClient.ts 还有本机生命周期的服务端请求。
因此“部署合并为一个本地 daemon”成立；“服务端业务主要只是订阅，可以省略”没有证据支持。
不尝试复制未知 Server 表结构，逐接口验证可见前置、错误和持久结果。

还发现之前总表没有充分表达的一类差异：**Human UI 能力不等于 Agent API 对等**。
当前 worker-application-service.ts 与 agent-host/src/worker-cli.ts 暴露 Run-scoped sync、
显式 message、Task claim/start/submit/review、Reminder 等。Raft agentApiContract 另外
定义 messageSearch、reaction、channelJoin/Leave/Mute、profileUpdate，以及 knowledge/wiki 等。
当前检查未找到这些全部对应的 Worker 入口；不能因 Human Search/Reaction 已实现就认为
Agent 侧也齐全。Task 创建/转换已有 claim-message 与单 owner 裁决，不能机械按 route 名称
判缺失；knowledge/wiki 与社区/集成市场须先核对单机适用范围。频道自助参与涉及既有
Activation credential 的 Room scope，是需要明确映射的权限差异，不能直接给运行中的
Agent 一个全 Workspace 访问令牌。本批只登记此核查项，不同时开工修改 Worker 权限。

下一轮开始公开频道前，先将该行为涉及的 Human 与 Agent 入口分别映射，明确适用角色。
本地后端审查从此同时检查 Computer 执行能力和原 Server 等价业务职责，不只查 UI 可点击项。

## 单项施工队列（本次重新排序）

已有拖放链路的本地交付见[验证记录](./2026-09-07-composer-drop-verification.zh-CN.md)。
本批完成 B019 媒体/文件双入口的本地交付（[证据与限制](./2026-09-07-composer-pickers-verification.zh-CN.md)），设计见[选择器合同](../design/composer-attachment-pickers.md)。
本表是依赖和出口设计；状态仍归机器行为登记，不另造“已完成”清单。

| 次序 | 单项范围                                     | 进入下一项前必须证明                                                                                                                       |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | B019 媒体/文件双入口                         | Raft 来源参数、真实 picker/取消/焦点/禁止态；同上传 owner，Chat/Thread 发送、重载和下载字节；正式安全重启。官网现场限制单列，不冒充全 B019 |
| 2    | 公开频道发现→预览→本人加入→发送              | Human 与 Agent 入口先分别映射；非成员正文/Search/附件同一读取资格，官方 Search 中栏保留和右面板导航；失权清屏、加入幂等、重载仍成立        |
| 3    | 离开频道及关注 Thread                        | 来源明确的订阅/取消语义，离开后的可读与可写边界；不借“关注”绕过私有 Room ACL                                                               |
| 4    | Room 创建、设置冲突、归档恢复、SOS           | 严格按列出的动作逐个处理，每个都证明持久结果、旧回执隔离、恢复和侧栏一致；已有 leave/delete 不重写                                         |
| 5    | 文件菜单，然后预览                           | 菜单逐动作核对来源及真实结果；再按类型收口预览/错误/大文件边界，Computer 离线时不声称非空文件树双边通过                                    |
| 6    | Agent Activity、Reminder、Workspace、Profile | 每次一个 tab 的正文/加载/失败/权限与对应后端；同时补该行为适用的 Worker API，而非只有 Human 按钮可用；角色/记忆跨 runtime 不变             |
| 7    | Computer 本机诊断、恢复管理                  | 从 Human 入口到真实本地结果与恢复回执；不扩建首期不需要的远程调度                                                                          |
| 8    | Settings、MCP、帮助                          | 每次一个适用设置或配置闭环，保存/失败/刷新有证据；无能力仍明确禁用，产品范围疑项先裁决                                                     |
| 9    | 通知设备、长期运行和发布                     | 补剩余同条件视觉/键盘/错误矩阵；设备真实呈现/点击、重启恢复及 soak 独立验收。真实付费 CLI 须另获授权                                       |

各项固定流程：先读官方来源/实操，再看 Multica；标明唯一前后端 owner 和实际差异；
加入可观察失败测试并确认 RED；最小实现至 GREEN；同条件浏览器与持久业务结果；
完整检查、冻结资产、备份/idle/安全正式重启、新页面验收，然后更新证据。
不以按钮数、旧测试数或估算 turn 宣称完整复刻。若官方/设备条件受阻，注明该层未验收，
本地已交付与全行为未验收同时保留，不能通过缩小描述把未完事项抹掉。

初期目标包括 Agent API 的适用行为，不能只查 Human 页面。消息搜索/reaction、频道参与、
资料更新等随所属行为一起核对；知识/wiki 的单机适用范围仍需来源裁决。Raft Server 中的
业务权限、上传和持久投影由本地 owner 承担，不因不做订阅而省略。

## 官网现场补充与不能遗漏的视觉差异

2026-09-07 实际打开官网，当前发布物为 index-BVfbaScj.js，SHA-256
65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde。
Search 中点击 #test 后，官方保留搜索中栏并以 open=channel 打开频道右面板；
该入口的面板保留/关闭/返回行为需纳入公开频道整条导航验收，而非只比较频道内容截图。
初次核查发现官方输入栏分别有“添加媒体”和“添加文件”，而本地当时只有单入口。
后续本批已补双入口，本地验收见上方记录；完整媒体草稿托盘及官网现场双边仍未对齐。
初次核查仅交付拖放子行为；后续双入口增量同样不将整个附件页面或 Search 分栏升级为完全对齐。
官网现场读取了控件和几何并查看截图，未向官方频道发送测试消息或上传用户文件。

[本批文件拖放验证与交付](./2026-09-07-composer-drop-verification.zh-CN.md)单独记录结果。
