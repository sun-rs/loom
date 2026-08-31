# 2026-08-31 第三方：官方发布源码行为合同反证审计

## 裁决与范围

本报告独立追踪当前冻结发布文件，不采信旧审计的“已对齐”结论，不修改产品代码，不启动官方 Computer，不运行付费 CLI，不提交。检查对象是可见行为、触发条件、请求和响应字段、权限投影、键盘与关闭、异步竞态；不是要求 RAH OS 复制中央服务器。RAH OS 仍由本地 Kernel 持有 Room ledger / Inbox / Task / Activation，由 AgentHost 持有 Runtime 与文件访问；CLI 安装和账号登录仍由用户负责。

结论：此前首批合同有正确方向，但有数项必须收窄的表述。特别是 **Activity 粉点、Chat 未读、Computer 状态点、Computer 主导航 attention 点、系统通知粉点不是同一个业务字段**。进入页面藏点不等于持久标读，查看系统通知不等于 dismiss，Computer 离线也不等于有未读。不能以已找到 1,836 个事件候选推导交互覆盖率。

本次未确认一个可利用的 P0 安全漏洞，也未审计全部本地实现。下文 P0 是阻止错误架构／错误验收的门槛，P1 是会改变操作结果的合同差异，P2 是样式、可访问性和需补证的边界。纯源码结论与同轮浏览器审计员的观测分别标明；本人没有操作浏览器。

## 证据身份和定位方法

目录：`docs/evidence/raft-web-20260831-current/`。以下短名均指该目录文件。偏移是 Node UTF-16 字符串位置，采用半开区间 `[start,end)`，不是字节偏移或美化后行号；函数名只是此发布版本的压缩名。重新计算 SHA-256 后读取原样字节，未执行官方 JS。

| 短名 | 文件                                   | SHA-256                                                            |
| ---- | -------------------------------------- | ------------------------------------------------------------------ |
| I    | `index-BoAC7nSE.js`                    | `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` |
| TI   | `ThreadsInbox-3Jpsnn_t.js`             | `d96b3205dab8f55287aa3af1e232e912649308ebc7d4b8713c76f8982f1f29da` |
| AD   | `AgentDetailPanel-DKwoNvgK.js`         | `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845` |
| MD   | `MachineDetailPanel-CIacRrGS.js`       | `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8` |
| RT   | `RefText-DkZjWJTy.js`                  | `8edbfa8dd09d7546cdf0988b5c02fbb71a29a44cac1606a476c2f59f0a13bc4e` |
| RH   | `RolePermissionHelpDialog-Ca2yhS_h.js` | `1cb7a7c54ff037f4a54542b7e8a487b73e3cd3834f4e0baade3a364094fc4160` |

机器索引的 23 文件 / 1,836 候选 / 892 `onClick` 数量与文件匹配，但它还列出 13 个缺失引用，包括 React、Markdown、socket vendor 和 `runtime-DpRgSJfR.js`。这只是检索入口。本报告追到了下面的少数业务链，不称全站完成、不给候选通过率。角色弹层等已追到本文件中的实际 wrapper；没有把未追完的通用组件行为补写成事实。

## P0：状态所有权必须分开

| 表面                         | 官方实际读取的状态                                                                    | 允许映射的本地 owner                                                            | 禁止替代                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Activity 主导航粉点          | 当前 Human 的 Activity active unread，加当前空间 Activity summary                     | Kernel `HumanActivity` / discovery 的持久个人 read/done frontier，再由 Web 投影 | 用 pending InputRequest 数、全部消息数、Agent 运行数代替               |
| Chat／频道／DM 未读          | Channel/DM 的个人 read state、unread count、mention flag，另有 membership / mute 条件 | 同一 Kernel 消息与个人读取投影；页面只提交查看／标读意图                        | 用 Activity 数或轮询成功当已读                                         |
| Computer 头像状态点          | Computer catalog 的 status 与 upgrade policy                                          | canonical Host / Computer read model；AgentHost 提供存活与版本证据              | 用 CLI inventory 的 `available`、有安装某个 CLI、没有 Run 当在线／离线 |
| Computer 主导航 attention 点 | 升级／离线问题机的数量                                                                | 从上述 Computer read model 派生，不另设“已看过”业务真相                         | 从 Computer 列表灰点颜色简单 OR；把点击当问题解决                      |
| 铃铛系统通知粉点             | 系统事项数组经过用户 dismissal key 过滤后是否非空                                     | 系统事项 projection 与有界个人 dismissal 偏好；事项 owner 保持原归属            | 当作 Human Inbox / InputRequest；打开弹层即全部清除                    |

官方 HTTP 路径只是前端合同证据。本地 typed application-service / RahClient 可以用不同路径完成同一授权与状态结果，不必为了名字复制一套 Raft Server 或第二份 Inbox。也不要复制官方把部分 UI 偏好放入 localStorage 的选择作为 RAH canonical state。

## P1：粉点／灰点的完整区别

### 1. Activity rail：个人未读聚合，并且仅在非当前页显示

源码链：I `BW` `[2806520,2817959)`；`wi` `[2820778,2821997)`；`Bu` `[2644307,2644494)`。

- `p = bs(state => state.activeUnreadCount > 0)`。
- `Z = currentServer ? unreadSummary[currentServer.id]?.activityUnreadCount : undefined`；`Q = p || Z !== undefined && Z > 0`。
- Activity 按钮传 `showDot:Q, dotInactiveOnly:!0`；`wi` 实际条件为 `!!(showDot && (!dotInactiveOnly || !active))`。默认 `Bu` 是 `bg-brutal-pink`，`size:'lg' → size-2.5`，黑色 1px 边框、圆形，图标右上 `-right-1 -top-1`，`pointer-events-none`、`aria-hidden=true`。不能给这个装饰 span 添加独立的点击业务。
- 单击导航 `/activity`；双击只 `setPendingFocusKind('first-unread')`、`loadInbox({reset:true})`。没有在 rail click 中调用 mark-all-read。
- `BW` 自己会 GET `/servers/unread-summary`，并在 Chat unread 布尔变化及 notification-preference 事件后重取；另一个 sidebar 实例有 30 秒／focus／visibility 刷新。不能把它描述成每次 render 同步准确的单一 count。
- `bs.loadInbox`（I 约 `2378030–2380940`）GET `/channels/inbox`，参数含 `filter, sort, q, channelId, limit, offset`；响应的 `activeUnreadCount` 与当前筛选的 `totalUnreadCount` 不等价。缺 `activeUnreadCount` 时只有 `filter==='all'` 才用本次 total，否则保留旧聚合。

同轮浏览器审计员已验证：1440×900 / DPR1，粉点为 `rgb(254,125,168)`、10×10；进入 Activity 点立即不见，页面仍显示“16 进行中 / 2 未读”，没有点任何条目，回到 Chat 后粉点复现。这是视觉抑制的反例，不是“进入 Activity 已读成功”。

### 2. Chat、频道、DM、折叠分组和其他空间

源码链：I `Cet/_et/BW` 约 `2805940–2806970`；`Ft` `[2138113,2156297)`；`met/fet/get` 位于 `[2736083,2741256)`；`AQe/TQe` `[2710574,2710792)`。

- Chat rail：只对 `Cet(channels, dmChannels)` 返回的 ID 检查 `Ft.unreadCounts[id]>0`。`type==='channel'` 必须 `joined===true`；其他 channel 类型不被这条 filter 排除；所有 DM ID 合并。这里没有排除静音。Chat rail 同样 `dotInactiveOnly`。
- `/channels/unread?summary=1` 返回 channel map（兼容旧数字项）；`XVe` `[2131562,2131987)` 提取 `unreadCount` 和 `hasMention`，再同 read-state ledger 对账。未读数与 mention 是独立字段。
- 频道 loud 粉色数字徽章：`unread>0 && joined && !showMutedIcon`。`showMutedIcon = activityMuted===true && joined===true`。有未读但未加入／已静音时为低强调灰数字，而不是直接完全隐去。计数均截为 `99+`。
- 提及标记：`mentionFlag && joined`；是带 `@` 图标的独立标记，不由 pink unread badge 自动推导。草稿铅笔通常在没有未读数字时出现。
- DM 数字不复用频道 mute/joined 判断；`fet/get` 直接读对应 DM 的 unread count。Agent DM 头像右下的 `Xz → ip` 点是 Agent activity，不是 DM 未读。
- 折叠分组点：`Gn.section && xd.section` 或 `collapsed && customUnreadSet.has(sectionId)`。展开分组只是把汇总点隐藏，不标读。`xd` 约 `2764313`，自定义分组约 `2764790`。隐藏 DM 若新增未读，可重新进入可见列表（`oc/du/_o` 约 `2765040`），所以“关闭聊天”等于永久隐藏是不正确的。
- 空间头像右上点来自 `Koe` `[2711837,2711954)`：**其他**空间 `activityUnreadCount>0`，排除当前空间；不是任意空间 `unreadCount>0`。`Voe` 只接受非负安全整数的 Activity count。空间 push mute 又是不同字段。

### 3. 哪些行为真的更新读取状态

源码同时存在显式整频道标读与可见尾部的 seq 标读，不能将二者简写为“点一下清点”：

- Sidebar 选 Channel/DM：I `Tn` 约 `2749780` 在本地已有 unread 时先 `clearUnread`，然后 `markRead` POST `/channels/:id/read-all`，失败重新 `loadUnreadCounts`；`Wn/Kr` 约 `2750470` 在导航前调用它。
- 初始消息加载及向下加载：`Ft.loadMessages/loadNewerMessages` 在条件满足时经 `GV → JF → ZF` POST `/channels/:id/read`，body `{seq}`。`t0` `[2130312,2130483)` 要求页面可见、focus、读取上下文许可；`WV` 对实时到达还要求最近用户交互。近底部、没有 newer gap 时才 `markCurrentChannelRead`（约 `2155593`），不是任何后台 fetch 都标读。
- Activity 项：TI 约 `19800–21070`，单击有 220ms 延时以区分双击；项 unread>0 时调用 `bs.markRead`，再打开目标；双击可走完整页面，单击也有紧凑／split preview 分支。`bs.markRead` 约 `2380980` 是带 server/principal/epoch/generation 的 in-flight 去重，先乐观减 count，再由 `iae` `[2095335,2095654)` POST `/channels/:id/read-all`；失败重新拉 Activity，不是用 UI 消失证明服务器成功。
- Mark all read：I 约 `2382113` POST `/channels/inbox/read-all`，再刷新 Channel、followed Thread 和 Activity。
- Mark done：I 约 `2382778–2384220` 是另一种操作；对 Thread POST `/channels/threads/done`，对 Channel/DM POST `/channels/inbox/done`，当前协议带 `throughActivitySeq`、`frontierSpace:'storage'`，兼容缺 frontier 的旧项。无法确认当前合法 frontier 会先 refresh。**Read ≠ Done ≠ Task completed ≠ InputRequest resolved**。
- Mark unread：I 约 `2140000` POST `/channels/:id/unread` 并重取；不是只在客户端加一个点。

### 4. Computer 头像灰点、升级粉点、主导航粉点

源码链：I `Kz/zoe/xQe/wQe/Uoe/Boe` `[2700672,2701420)`；`pet` `[2733720,2735386)`；`fp` `[2191361,2191644)`。

| 对象                  | 精确条件和优先级                                                                                                                        | 显示                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Computer 列表头像点   | `Kz(machine) = isComputer===true && computerUpgradeAvailable===true`，`Uoe = Kz ? 'upgrade' : status==='online' ? 'online' : 'offline'` | upgrade 粉 `bg-brutal-pink`；online 绿 `bg-brutal-lime`；其他灰 `bg-gray-400` |
| 头像点 tooltip        | `$oe` 在 upgrade 且 offline 时有专门“离线且可升级”文案，可含 policy targetVersion；否则升级／在线／离线                                 | 原生 `title`；不是点击弹出卡片                                                |
| Computer rail         | `wQe` 计数：`Kz                                                                                                                         |                                                                               | (isComputer!==true && CD(daemonVersion,latestDaemonVersion)) |     | status==='offline'` | 默认粉点，并非灰点；非当前 Computer surface 才显示，hover 改为问题机数量／总数文案 |
| 移动 attention filter | `zoe`: 非 Computer 一律 none；Computer upgrade 优先，其次 exact `status==='offline'`                                                    | 不完全等于 rail 的 `wQe`；legacy daemon 可使 rail 有点而此 filter 无项        |
| Computer 详情连接状态 | MD 约 `29900` 直接 `status==='online' ? lime : gray`                                                                                    | 可与列表升级粉点同时存在：列表表示升级优先级，详情仍表示连接状态              |

`CD` `[434415,434578)` 只比较合法 `major.minor.patch` 数字，不支持任意 semver prerelease；legacy daemon upgrade 分支没有附加 online 条件。`wQe` 每台计一次，不把同机 upgrade+offline 算两次。禁止删除此 legacy 分支后仍宣称完整同源，也禁止把 mobile attention filter 和 rail 共用一个未经裁决的 helper。

`pet` 未传 size，故 `fp` 默认 md=`size-2.5`（10×10），黑色 1px 边框、圆形，位置 `absolute -right-1 -top-1`。`fp` 支持 sm=8px、lg=11px；不能从其他头像小点抄一个尺寸。Agent 的同一 `fp` 还可读 activity：online lime、thinking/working soft-signal+pulse、error orange、其他 gray；external 优先 cyan，见 `Uze` `[1782171,1782402)`。这又不是 Computer 规则。

同轮浏览器审计员确认：Computer 列表灰点 10×10，`title=离线`，computed background `oklch(0.707 0.022 261.325)`，详情亦离线。Activity pink 实测为 `rgb(254,125,168)`。本轮冻结目录没有官方 CSS，颜色值来自同轮实页观测，class/尺寸/优先级来自上述 SHA 的 JS，不能假称都从当前 JS 提取出 hex。

Computer catalog owner 为 `Zn` `[1812274,1817371)`：GET `/servers/:serverId/machines`，响应为数组或 `{machines,latestDaemonVersion,latestComputerVersion}`；`computerUpgradeAvailable` / policy 由 catalog 提供，不由 UI 从 CLI availability 猜。`E4e/O4e` 约 `1808648–1811810` 用 statusVersion 拒绝过旧 status；`machine:status`、`machine:capabilities`、`machine:updated`、upgrade/restart done 等触发 reducer／catalog reconciliation（约 `2416500–2423500`）。点 Computer 或 hover 不修改这些字段；只有目录／事件状态变化才能改变其业务状态。

### 5. 系统通知：名称叫 hasUnread，不代表消息未读

源码链：I `SQe` `[2702189,2708672)`；`CQe/Hoe/_Qe` `[2708672,2710573)`；dismiss store 和 `bQe/vQe` 约 `[2696410,2699010)`。

- `SQe` 根据空间方案降级宽限期、资源超限、machine offline/outdated、PWA 安装资格构造系统事项。Computer attention 项只在 mobile flavor、`manageMachines` 且机器与 Agent 不在 loading 时构造；legacy daemon offline/outdated 另走独立事项。
- `CQe` 删除 dismissal key 已存在的事项；`Hoe` 用剩余 `notifications.length>0` 设置 `hasUnread`，并画粉点。这条路径没有读取 Human InputRequest 或个人消息 Inbox。
- 打开／关闭只改局部 `open`。Desktop trigger 支持 hover，delay=0 / closeDelay=120；mobile trigger 是点击并配 tooltip。弹层 `w-80`、desktop 右侧 / mobile 底侧、align=end、offset=8、keyboard 才 initialFocus。
- 有 key 的 dismiss 把 key 放入 `slock:notification-center:dismissed:<serverId>`，持久写入最近最多 100 项。机器列表／升级 policy revision／targetVersion 改变，key 可改变而再次显示。它是有界 UI 偏好，不是 Kernel acknowledgement。
- 查看按钮做导航，不自动 dismiss。PWA “dismiss” 是另一路 sessionStorage 资格控制；部分事项没有一般 dismissal key，不能给所有通知硬加同一“已读”按钮。

浏览器当前官方通知为空 `data-has-unread=false`，只能验空态打开／关闭。非空事项、dismiss 持久化和 key 变化目前是源码已证，不是本轮双边现场通过。

## P1：已有合同中需要纠正／收窄的行为

### 6. Computer “默认第一台”不成立；应区分记忆导航与无选择页

I `Mz` `[2643687,2644269)` 对 Computer 优先读取 `iJe` `[2642302,2642481)` 的 `slock:tabMemory:v2:<serverSlug>:computers` URL；无记忆才到 `/s/:slug/computers`。`cJe` `[2642807,2643050)` 记录之前所在 surface 的完整路径和 query/hash。

`dct` `[3358805,3359114)` 对普通 desktop（>=768px 且非 `bk()` 模式）渲染 `nf({channel:null})`；窄屏或另一模式渲染 Computer 列表。没有“首台自动 redirect”。`pet.selected` 则来自 pathname／workspace ref，而不是数组第一项。

同轮浏览器审计员已直接进入 `/s/hakasemac/computers`：左列有一台离线机，右侧是“选择一个频道”空态，没有自动选第一台。先前点 rail 进入 Mac-Studio 只证明保存过的详情路径。`docs/product/2026-08-31-files-and-computer-contract.zh-CN.md` 的“Computer 导航直接显示第一台”不能当普遍官方合同；本地默认选首台可以是明确产品裁决，但不是 byte-exact 行为复刻。

### 7. 消息头像点击不是无条件打开“动态”；hover 内容也有权限

I `Xrt` `[2935728,2938862)` 支持 Agent 和 Human 头像：hover delay=200ms、closeDelay=120ms、宽280px、offset6、collisionPadding6，`Q2` 约 `961351` 默认 fixed position。点击会先关闭 preview，再调用 Agent/Human profile handler；触摸长按 >=500ms、移动阈值10px 时插入 mention，并抑制随后点击（常量约 `2913602`），不是所有 touch 都打开 profile。

关键反证：`vrt` 约 `2913241` 传 `defaultAgentTabIntent:'ordered-first'`；`brt` 按空间保存的 `agentPanelTabOrder` 取首个有效项，默认序列以 `profile` 开头；URL 同步约 `3235669` 将其写为 `agentTab`。所以当前账号第一项若是 Activity，点击可能看到动态，但“总是打开动态”不是此版本源码合同。

`RO` `[2866713,2871575)` 读取 Agent、Computer、model descriptors 和 trajectory；只有 `Ctt` `[2864746,2864825)` 为真（能 manageAgents，或当前 Human 是该 Agent 的 user creator）才请求最近5条轨迹并显示 operational detail。普通用户仍可看到基础身份／状态，但不能据截图给所有成员暴露同一轨迹。AD `qc` 约 `130540–130950` 还根据权限过滤标签：profile 常在，mcp 要 manageAgents，其余 operational tabs 要上述许可。七标签“存在”不是所有角色都能看七标签。

姓名按钮则是另一操作：I 约 `2946010–2946350` 只有能解析合法 sender handle、非 deactivated／特定不可提及状态时创建 `Ln`；`Sa → Ps → LGe` 发带 `channelId` 的 mention-insert 事件，不导航也不发送。显示姓名与插入 handle 可不同。现有“姓名插入当前 composer”方向成立，但应保留 unavailable sender 和 Thread channel context 反例。

### 8. Agent「聊天」并非所有行都可进入对话

AD `xc` `[64062,68520)` 分开请求 `/agents/:id/channels` 和 `/agents/:id/agent-dms`，有各自 loading/error，effect cleanup 阻止旧 Agent 响应应用。频道经 `gc` `[63558,63607)` 过滤 archived，首屏5项，可 show all/fewer；频道行 button 调 `toChannel(id)`。

但 Agent-to-Agent DM 的 `ec` `[61377,62145)` 只渲染摘要卡、对方 Agent、最后活动时间／preview，footer 是 `activityOnly`，调用点没有 `onClick` 或导航 callback。不能把它映射成当前 Human 可进入／发送的普通 DM。RAH 可以保留已有 Human ACL 可见 Room/DM 目录，但应标为本地合同差异；不得为了“可点击”给 Human 开放 Agent 私有 DM。

### 9. Agent 动态引用：文本候选解析属实，DM 接线仍需专门反例

RT `M` `[213,851)`、`D` `[1430,1962)`、`T` `[1962,2521)`、`F` `[3360,3691)` 确实识别 `#channel`、`#channel:shortid`、`dm:@peer`、`dm:@peer:shortid`，已足以反驳旧“完全不解析文本”的说明。可解析项才生成 link；找不到目录项保留普通文本。Thread 请求 GET `/messages/context/:shortid`，query `channelId`，由 I `Ile` `[2895272,2896113)` 读取 canonicalTarget / targetMessageId 或缓存 Thread，再导航父消息并开 Thread；`Ant` `[2893633,2893743)` 比较 serverSlug/epoch 拒绝过期导航。异步 link 用 `aria-busy` / pointer-events-none，非 Task-only metadata。

不过 RT `M` 只订阅 `Ht.channels`（RT 约 `213`），而该 store 有独立 `dmChannels`，`loadDMChannels` 在 I `1900709` 请求 `/channels/dm` 并写后者。RT `$` 却从传入 `channels` 找 type dm。源码证明 **语法支持 DM**，尚不能证明当前实际目录总能解析 DM：若 `/channels` 未同时含 DM，它会保持文本。未读取真实响应，不能直接宣布官方 bug，也不能宣称所有 DM 链路通过。应在已有真实 Agent 动态里选一条 `dm:@peer:shortid`，核对目录、link 是否生成、响应与定位结果。

同轮浏览器已验证一个 Channel shortid 目标成功变为 full `msg` + `thread` URL 并打开消息列；这只证明该 Channel 目标，不代替 DM、重名／不存在／权限拒绝、server 切换晚返回或工具实际 Task 目标。

### 10. 角色说明是权限说明；关闭合同比旧文档简单

RH `p` `[718,1435)`：Human 显示 owner/admin/member，Agent 显示 admin/member；subject 决定条目。I 文案约 `1616604` 对 Agent admin 明确只有服务器资料、频道和频道成员，尚不包含 Agent、Computer、邀请、加入链接或角色提升。不能把它等同 Human admin，也不能把 AgentDefinition 人设 prompt 写进权限字段。

AD `hc` 约 `94900` 的问号是原生 `title=角色权限` button，click 显示 RH，不是自定义 hover card。role editing 另由 canChangeAgentRole、当前真实 serverRole、可允许角色集合控制；不能仅有问号就推导当前 Human 可以改角色。

RH 显式 `closeOnBackdrop:true`；I `Ug` `[1968387,1968961)` 提供 close button，`ci` `[1967363,1968387)` 默认监听 Escape、初始 focus 到 overlay 容器、点击 backdrop 时关闭。该 wrapper **没有 Tab trap 和关闭后 restoreFocus 代码，也没有 role=dialog／aria-modal 设置**。不能因本地 `useDialogProtocol` 有这些能力，就记作官方源码规格相同；本地更强的可访问性可保留并明确差异。preview 的跨触发器 Tab/Escape 完整行为须独立实页复核，不能从 modal wrapper 推断。

## P1/P2：文件树合同可施工，但不要复制官方竞态

AD `No` `[20829,30728)`、`Ks` `[18840,20418)` 支持的条款：

- 根 GET `/agents/:id/workspace-files?includeHidden=…`；逐目录同路径带 `dirPath`；按 path 缓存 children 与 expanded set；原始结果无数据、loading、失败+retry 分开。
- 文件 GET `/agents/:id/workspace-files/read?path=…`。根标签先取 `runtimeProfile.current.workspacePathRef`（仅 display），缺省 `~/.slock/agents/:id/`。不能凭这个 label 证明服务器访问的是当前项目 cwd，更不能用于授权根目录。
- 刷新清 children/loading cache，但保留 expanded set 并重载展开目录。隐藏切换按 Agent 存偏好，重置 selected preview 和 expanded set。
- width 的共享 hook 参数为 key `slock:workspaceTreeWidth`、min160/max600/default256；hit area 8px，pointer down/move/up/cancel；不是每个 Agent 独立 width。
- copy path 成功状态1500ms后归零。文件选中粉 `bg-brutal-pink/20` + 右2px粉边，hover黑5%；层级每级16px。markdown 有 raw/preview 切换；compact／窄屏有返回树按钮。

须收窄的现有描述：

1. “Agent 切换后的旧响应丢弃”只在根／目录 **成功** 分支有 `S.current!==agentId` 检查。根失败 catch/finally 仍可改 state；同 Agent 连续刷新／隐藏切换没有 request generation 比较。
2. file `re`（约 `22239–22551`）没有 Agent 或所选 path 的过期检查。快速 A→B，晚到的 A 可写 `L(R)`；切换 Agent 也不能从此函数证明旧文件响应丢弃。这个是静态竞态反例，不宣称已实页复现。
3. “选择时清空旧预览”不精确：它置 selected path、loading=true、error=null，但没有 `L(null)`；旧 preview 被 loading 分支隐藏。完成后仍需验证响应属于当前选择。后退清空 preview 也不会取消先前请求。
4. `Ks` 是递归原生 button，没有 `role=tree/treeitem`、`aria-expanded` 或 Arrow key tree handler；原生 Tab/Enter/Space 与完整键盘树不是同一规格。RAH 自有方向键导航可保留，不能写为已从此源码确认官方相同。
5. 复制失败分支没有 catch／错误反馈；目录 lazy-load 失败只 console.error，expanded 空节点不等于目录确实为空。RAH 可以提供更明确错误／retry，不应机械复制沉默失败。

建议本地以 AbortController 或同 owner 的 identity+request generation 处理取消，并测试同 Agent 两文件乱序、隐藏切换乱序、失败晚返回、后退后返回。源码冻结给出正常行为，安全边界与异步正确性由 RAH owner 保证；官方 Computer 离线只阻碍官方非空结果现场对照，不阻碍本地只读文件能力施工。

## P2：Chat Enter 合同的准确范围

I composer `ra` 约 `[2238100,2238840)`：先拒绝 IME composing / keyCode229，再让 mention/resource picker 消费键盘；Ctrl/Meta+Shift+Enter 强制 Task；普通桌面 Enter 发送，Shift+Enter 换行，粗指针竖屏 Enter 也换行。`Gn` 约 `2232501` 本身再检查 sendDisabled/pending、空内容、附件 validating/uploading/error，再提交，不能绕过按钮权限。

现合同已经明确 RAH 按用户选择统一 Enter 发送且未复制粗指针／强制 Task，属于诚实的本地差异。应保留该标注，不为了“1:1”把用户裁决反改；composer候选打开、IME、重复 Enter、附件未就绪、Thread/Room 切换仍应分别验。

## 建议反例和剩余验收门槛

| 优先级 | 最小反例                                                                                 | 要证明什么                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P0     | 有 pending InputRequest、但 Activity unread=0；另反向有 Activity unread、无 InputRequest | 不把 Human 输入阻塞、Activity、系统通知混为一个 bell count                                                         |
| P1     | Activity 有 unread → 进入但不点项 → 离开                                                 | 视觉藏点≠持久标读；本轮官方已证                                                                                    |
| P1     | 静音已加入频道有未读，未加入频道有未读，joined mention+unread                            | loud/quiet、mention、Chat aggregate 的条件分别正确                                                                 |
| P1     | 同一 Computer offline+upgrade / online+upgrade / legacy outdated                         | 列表升级优先、详情连接状态、rail问题数、mobile过滤不混用；不需真实启动官方 Computer，可先用隔离 read-model fixture |
| P1     | 直接 /computers 与从记忆过详情的rail进入对比                                             | 自动首选和记忆路径不可混称；本轮官方已证直达空态                                                                   |
| P1     | 消息头像的首个有效tab为profile或activity；普通成员非creator hover同一Agent               | 默认tab受顺序影响，轨迹受权限控制                                                                                  |
| P1     | Agent Chat 一条频道与一条Agent-to-Agent DM                                               | 频道可导航，DM仅摘要不得自行授予访问                                                                               |
| P1     | 动态 `dm:@peer:shortid`、未知短号、重复前缀、server切换慢响应                            | 语法支持不等于实际可解析；stable target+authority fence                                                            |
| P1     | 文件A慢/B快、Agent切换、hidden切换、后退后晚返回、root旧请求失败                         | RAH不能复制官方缺失的请求generation保护                                                                            |
| P2     | 系统通知非空打开/关闭、查看、dismiss、重载、policy revision变化                          | 打开/查看不清事项；dismiss与事项变化重新出现不同                                                                   |
| P2     | role问号hover/click/backdrop/Escape/Tab/关闭后焦点；头像preview跨触发器                  | 原生title、modal、preview三类不是同一关闭协议                                                                      |

交付限制：本报告不宣布上述全部反例已执行，不宣布全部页面1:1，不宣称源码归档完整，不改变现有产品／owner文档，也不判断用户运行中的 daemon 已升级。独立浏览器审计的截图、操作记录与最终双边矩阵由本轮浏览器报告保存。本次仅新增本报告；产品测试门禁不因一份只读源码审计自动获得通过。
