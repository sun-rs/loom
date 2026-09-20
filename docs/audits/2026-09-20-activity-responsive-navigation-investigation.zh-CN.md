# 动态卡片响应式导航与共享分栏修复

## 来源与范围

沿用 [页面选择审计](2026-09-20-surface-selection-parity.zh-CN.md) 的 Raft
v1.16.0 index-CKeqacxz.js 来源、hash、许可边界。重新读取公开动态 chunk：
https://app.raft.build/assets/ThreadsInbox-Bl_yi0it.js ，SHA256
`25cf5bc2a17e619b356eb9f2dc0183e2ab9815a452dd748af70066a5b43bef86`。
发布文件仅分析，未复制代码。Multica 创建/执行模型不参与本次浏览器导航分析。
来源调查已在 RAH 正式浏览器复现；本次按用户后续确认的规则实施。
未执行 Raft 同视口动态页面的双边验收，不声称逐字移植。

## Raft 明确区分点击方式与后续布局

格式化动态 chunk 的 Gt/Ve/mn（约 650、1012、1037 行）：单击按当时
matchMedia 判断打开 side slot 或调用 toMessage/toDmMessage/toThreadMessage。
`activity_sidebar_inbox_v0` 关闭时阈值为 min-width:1024px，开启时为
min-width:768px。因此用户观察的 768–1023 直接路由行为符合前一个分支，
不能断言所有用户/feature flag 都永远如此。宽屏双击还会明确进入对话路由。

主 bundle Ift、Tft 与布局约 165975、187185、187208、187370、187715 行：
侧栏预览已打开后，桌面布局按 768px 判断是否保留列表；宽档默认 560，范围
400–720；紧凑档默认 320，范围 320–480，1024px 以下切紧凑档。
额外的消息列或资料面板也能触发紧凑档，并非只有 viewport 一个条件。
缩窄不等于重新执行一次卡片点击；已打开的 side slot 可以一直保留，手机只展示
目标面板，再放大恢复动态列表+目标。若点击时已经实际导航到频道/私聊，放大则
显示聊天列表+正文。返回逻辑由既有导航历史/来源与 slot close 分别承担。

## RAH 三个已定位问题

1. App.openDiscoveryLocation + navigation-target.retainsActivityBackground
   按目标类型而非点击时宽度分流：消息列通常保留 activity，普通消息去 room。
   已加入频道与非成员公开频道另有不同 preview 分支，行为因此不一致。
2. GlobalActivity.mark 从 message.context 无条件传播 rootMessageId。
   context 为拥有消息列的顶层根消息返回自身 rootMessageId，但 message.threadId
   仍为空；HumanNavigation.resolve 只按所属 thread 联表，预期 rootMessageId 为空。
   因此导航校验报 message target is stale or unavailable。已在正式 Agent Council
   顶层卡片复现。应统一区分“消息属于消息列”与“消息拥有一个消息列”，不能删掉
   ACL 或放松真正的房间/消息列不匹配检查来掩盖。
3. 正式页面 1440×900 点击消息列后，动态 main DOM 仍存在，但测量宽度为 0；
   thread 位于 grid-column:4。global-discovery.css 声明三列，product.css 的
   `.rah-product-shell[data-conversation-layout="split"] > .thread` 把普通聊天
   四列定位带入全局动态。截图 `/tmp/rah-activity-investigation.png`。
   这是布局作用域冲突，不是动态列表没有数据。

## 用户确认后的实现合同

用户明确覆盖早先“中窄屏跳聊天”的建议：所有宽度下点击动态卡片均留在动态页。
这是有意区别于上游点击分流的本地产品规则；不移植实验开关。

- Activity 复用 conversationPanels/useConversationLayout，频道、消息列、成员资料
  共用聊天页的 split/replace/fullscreen 与逐层返回逻辑。
- 动态列表替换聊天 sidebar；保留筛选、组件和滚动，不复制业务消息状态。
- 宽档 560（400–720），紧凑档 320（320–480）；小于 1024 或额外面板触发紧凑档。
  复用 SearchPreviewResizer 的指针与键盘逻辑，使用独立 activity 宽度记忆。
- Activity 用 previewRoom/previewThread/previewRoot 保存主预览，内部任务与消息列
  使用现有 thread/task 参数。窗口缩放不改 surface，不变成聊天列表。
- root context 只在 message.threadId 存在时传递所属 rootMessageId；权限与目标
  不匹配校验保留。拥有消息列的顶层消息不冒充消息列成员。
- 页面组合为列表＋频道＋消息列，或列表＋频道/消息列＋资料；窄屏只展示最右侧
  活跃内容，返回逐级恢复。隐藏频道不提交可见阅读确认。

单一 owner：App 负责页面组合，navigation-target 负责目标归属，共享 conversation
布局负责面板可见性，现有 Kernel/SDK 仍负责内容与权限。没有新队列或消息存储。

## 验证

导航单测先失败后通过。`scripts/test-activity-panels-browser.mjs` 使用隔离真实
Kernel 与 Fake CLI，覆盖根消息、消息列、任务、资料、宽窄往返、分隔线键盘边界、
刷新和逐级返回；新任务先返回最新消息窗口再点击，保留历史定位机制。
Chromium、Firefox 均通过；补充真实指针拖拽、浏览器前进后退，以及直接消息列
放大后的右缘断言（后者捕获并修复了四列 grid 高优先级覆盖）。截图已人工查看。
Web typecheck、正式 bundle build、git diff --check 通过。整体 check 仍阻断于
既有未登记 `/v1/worker/message-present`；format:check 仍有此前 5 个文件问题，
本批改动文件已格式化。共享 sidebar-row/sq-btn CSS 来源报告重新生成并通过。

正式构建 `e80a31f6a3d07bfec00bbdde752c9bdb1a21a659dedae66706ca7792ff594448`
在安全检查、持久状态备份后启动，新进程 29119 监听原正式地址。备份为
`pre-restart-7027da75-d742-4926-b377-1fb6a73075e1`。新建浏览器页面验证正式数据
频道、私聊、消息列入口、1800/1000/390/1440 缩放、刷新及手机返回动态列表；
只允许读取和已有阅读确认，不发送消息、不更改任务、不调用付费 CLI。
未执行同条件 Raft 双边浏览器验收；响应式参数来自上述源码。

## 点击首屏的一致性补修

用户截图揭示此前只检查最终定位，未覆盖中间帧。message.context 的正文可先于
RoomData（成员、任务、消息列批次）返回，createRoomViewModel 因而把未解析作者
显示为 principal ID 和蓝色首字母头像；配套数据补齐又改变高度并重新定位。
这不是删除身份被复活，也不是消息发生修改。

现在共享正文组合在同一 RoomData 与目标 context 就绪后才交给消息视图；等待时
显示同步状态，不把缺数据占位身份当正文，也不先显示频道尾部再跳到目标。
后台轮询已有完整数据时继续保留当前正文。此处为 App 组合层的一致性修复，
不新增业务状态、不修改持久历史、不扩大消息窗口。

新增 scripts/test-activity-loading-browser.mjs，隔离 Kernel/Fake CLI 延迟
rooms/sync，等待两次 context 响应后断言无半成品正文；旧实现复现失败，新实现
待完整数据后显示真实作者。保留多面板、返回和缩放浏览器回归。

首屏补修验证：延迟响应测试、多面板回归、Web typecheck、bundle build、diff
检查通过；整体登记与 5 项格式阻断仍为既有问题。安全重启构建
`0fe6d67cbf3daa84fb435c3ac450b3a8535d2d30fae65f784e5ddb7fede292b0`，
备份 `pre-restart-31e79af7-ff4d-4e98-8b5f-c185e7e26c21`，新进程 34220。
正式数据全部 16 张卡片在 1440 和 390 宽度下共 32 次通过；加载全程的
MutationObserver 检查可见作者栏，未捕获 principal_ 占位身份闪现。

## 后续用户确认的点击与审批规则

“始终留在动态”现在限定为单击；双击明确进入聊天对应消息位置，复用相同消息 ID
与蓝色定位，不复制导航业务。已选卡片再次单击不重复 context/resolve；未完成
单击也不禁用双击，最新导航 epoch 继续拒绝迟到结果。

任务颜色标识的精简审批仅适用于 iOS 独立 PWA 的窄屏；桌面浏览器即使缩窄也
保留完整任务讨论，窄屏用现有全屏返回，宽屏用遮罩弹窗。动态正文任务标识与
聊天正文使用同一审批组件。消息列入口本身继续使用动态内部分栏。

动态直接消息列左侧不再与列表右边框叠加；拖拽区域仍为 8px，焦点/拖拽使用
共享细线，不以整个热区描边。小于 768px 的动态频道/私聊隐藏关闭预览按钮，
与聊天一致只保留返回。

此批验证：重复单击旧实现发出 resolve 的断言失败；直接消息列旧边框 2px 与
列表边框叠加，修正后为 0；旧 width-only 审批缺少 textarea，新 desktop/iOS PWA
双场景通过。Chromium、Firefox 分栏回归及既有聊天审批交互通过。iOS PWA 使用
浏览器 UA/standalone 仿真，未声称真机验收。类型检查、正式构建和 diff 检查通过，
既有登记及格式阻断不变。

正式安全重启构建 `63bcaed1abfe974a3a543b3894ced1ad230a5c77097801a4ee8b259ae7a07dc4`，
新进程 39283，备份 `pre-restart-a544d5c8-702b-4528-a7b1-e3ae2cecf1f9`。
新浏览器验证真实数据重复点击零 resolve、双击进入聊天同消息 ID、Gemini 私聊
窄屏只有返回、窄桌面完整任务讨论与返回；已检查截图。

## 首屏等待链路补修

用户反馈一致性屏障消除占位身份后，慢连接上同步等待过长。正式本机抽查三张
频道/消息列卡片，本轮请求约在点击后 60–200ms 内完成，未复现数秒延迟，不能
把本轮快速结果当作用户环境验收。代码确认 Room sync→ack 完成后才启动消息、
任务、成员、消息列和活动读取，存在不必要的串行网络往返。

App 数据组合 owner 现在并行启动这些独立且各自经过鉴权的读取，全部完成后仍
统一发布 RoomData。RoomSession 的同步/ack 顺序、取消围栏、消息窗口边界和
conversationReady 身份屏障不变；不通过占位身份、持久缓存或跳过权限检查加速。
该变化是本地请求编排优化，不声称 Raft 源码移植；沿用上述上游展示合同。

延迟浏览器测试先阻塞 rooms/sync，断言其他五类读取已经发起，同时正文仍不可见；
旧实现失败（0/5），修改后通过（5/5），释放同步后作者正确且无 principal_ 闪现。

随后扩展正式逐卡验收，在 #all 卡片的桌面和手机入口均复现约 5.4 秒等待。
进一步确认主因：openDiscoveryLocation 无条件清空 RoomData，而目标恰为已经
选中的 activeRoomId 时，读取 effect 的依赖未变化，没有立即重读，只能等待
下一轮轮询。现在保留相同 Room 的已有完整投影，仅切换到不同 Room 时清空；
目标 message.context、导航鉴权及请求代际检查仍照常执行，没有新增缓存 owner。

新增“关闭预览后重新打开同一 Room”用例，阻塞后续同步，要求在 1.5 秒内显示
已有身份完整的正文。旧行为稳定失败并停在同步提示；修复后不依赖轮询。

保留同 Room 数据后，既有多面板门禁进一步暴露 popstate 回到无预览动态页时
未清理 activeThreadRootMessageId 的问题。历史导航现在显式按目标 URL 重置
消息列选择，返回列表不依赖轮询或数据清空来间接隐藏面板；同一门禁先失败后通过。

最终验证：Chromium/Firefox 延迟读取与同 Room 重开测试通过；多面板缩放、刷新、
浏览器前进后退通过；Web 类型检查、正式构建和 diff 检查通过。全仓库 check 仍
阻断于既有 worker/message-present 登记，format:check 仍为既有五文件问题。
正式实例完成备份与安全重启，构建
`9c6064bc961eb76064f6564ff07f059d2ba3a3830a4b2a7792741fc8e7053de2`。
新浏览器读取正式 16 张卡片，在 1440/390 两种宽度下共 32 次检查全部通过，
从点击到目标可见测得 124–192ms；此前 #all 入口约 5395ms，修复后 192ms。
这是同机本轮测量，不是所有网络条件的延迟保证。逐帧身份监测未出现 principal_
占位，目标蓝色定位及手机消息列截图已人工检查。未发消息、改任务或运行付费 CLI。

## 单击／双击仲裁与离页清理

再次核查同版本 ThreadsInbox 的 mn（格式化 1012–1036 行）：桌面首击以 220ms
计时后调用 Ve 预览，detail >= 2 取消计时并调用 xn 路由；卸载取消计时。
RAH 原 onClick 首击立即请求，onDoubleClick 再请求，且离开 activity 未重置
searchPreview 内存选择，返回时出现没有内容的预览占位列。

结构性移植该 220ms 仲裁，detail >= 2 取消首击，键盘 detail=0 保持立即打开；
过滤范围变化、客户端变化、卸载均取消未执行计时。沿用既有请求代际取消，慢双击
若首击已发起，第二击仍可取代它。App 离开 Activity 时重置临时 preview 槽位，
保留真实聊天目标及定位。未引入第二个导航状态 owner，也未移植 Raft 宽度路由分支。

门禁先复现双击后经导航栏返回仍存在分隔线；修复后断言没有残留分隔线且列表
占满可用空间。补充首击 100ms 内无 context 请求、第二击直接路由；覆盖已经
打开预览再双击，以及原有缩放、刷新、浏览器返回行为。

单／双击补修验证：Chromium、Firefox 多面板门禁通过，Web typecheck、正式构建
与 diff 检查通过；全仓库登记和五文件格式阻断项未变化。正式实例完成备份和安全
重启，构建 `8e1bf6038caf47046d225e7d42e5c7ed31f1b994539fb8e9dbb21977c081d83b`。
新浏览器遍历正式 16 张卡片，交替覆盖直接双击和先单击预览再双击，全部跳到
对应聊天目标，点击动态导航返回后无分隔线残留、列表恢复完整宽度。截图已检查。
未执行 Raft 当前登录页面双边验收；仲裁参数来自已记录版本的发布源码。
