# Room／私聊最多两页的布局统一

## 用户决定与来源

采用最多两页的默认模型，不按大屏自动增加第三列。点击来源留作左侧上下文，新目标进入右侧；
空间不足时只显示新目标。Room设置与Task详情弹窗是覆盖层，不计入主内容的两页，不挤占宽度。

授权Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`：
pretty Jmt 170304之后根据Thread/profile的openedAt和profile.openSource选择最新目标；
collapseChannel／collapseThread按来源折叠旧页面。171100之后thread-layout-container只组合
thread-main-column和Jmt侧栏；Task路径使用独立Ei模态覆盖层。沿用既有680px内容宽度、768px
移动边界，以及横屏或viewport>=1280时允许分栏的参数。该行为是结构移植加本地UI状态接线，
并非逐字复制源码；没有新增图标、字体或授权资产，既有来源/notice保持。

对照Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/layout/tab-presentation.tsx`及dashboard布局：其页面标签以URL和实体缓存解析，
不提供更直接的Room/Thread/profile两槽模型。本次未复制Multica代码（Apache2及附加条款）。

## 唯一owner与可见规则

apps/web/src/conversation-panels.ts负责纯展示选择；App保留最新打开目标和点击来源，并继续
使用原Room、Thread、Agent/Human资料状态。IdentityOriginContext由Thread入口提供，头像、
正文身份引用和资料浮窗中的动态入口携带来源；Thread关注者直接使用thread来源。
权限解析成功后才切换目标，原导航generation继续丢弃过期异步结果。

| 原布局和动作                   | 宽屏结果             | 窄屏结果     |
| ------------------------------ | -------------------- | ------------ |
| Room内打开消息列               | Room＋消息列         | 消息列       |
| Room＋消息列，从Room打开人员   | Room＋人员           | 人员         |
| Room＋消息列，从消息列打开人员 | 消息列＋人员         | 人员         |
| Room＋人员，重新打开消息列     | Room＋消息列         | 消息列       |
| 关闭当前目标                   | 恢复保留的上一页组合 | 恢复上一目标 |

useConversationLayout仅扣除导航栏；不再先扣一个独立inspector宽度。Thread和会话内人员页
共用useThreadPanelWidth与同一分隔条规格（默认400、最小360，CSS额外保留来源320），
替换时沿用右槽当前宽度。独立成员目录仍沿用其原本宽度owner。

保留页面实例用于恢复草稿、所选标签和同一人员未提交的资料编辑；显式关闭人员页或切换
Room仍使用原关闭生命周期，不建立无限历史栈。隐藏的资料页不处理Escape，隐藏内容不可
接收焦点或指针。虚拟消息测量和滚动仍由既有MessageTimeline负责，不新增滚动状态机。

RoomHeader原设置入口会先清除activeThreadRootMessageId，本次移除该副作用；设置遮罩、
滑入滑出、Escape及焦点恢复继续由RoomMembersDialog共享协议负责。Task页复用现有Thread，
全局Task详情保留原覆盖层。没有修改Task状态、消息投递、权限或Agent执行。

## 验证记录

先运行新增页面选择单测和浏览器场景：旧实现从Thread点击头像后Room仍可见，复现三列；
设置场景复现消息列被删除。新增滚动断言还发现display:none会让保留页面失去虚拟列表测量，
故采用保留槽位测量、隐藏且inert的表示方式，而非改写滚动owner。

专项覆盖Room和真实canonical DM的Agent/Human头像、关注者入口、动态浮窗、最新目标优先、
迟到的权限解析不覆盖新点击、右槽宽度、双侧输入草稿、未保存人员名称及标签恢复，
2560/1920/1440/1200/900/390宽度、Room Task页和桌面/移动Task模态页面。Fake CLI仅在
临时状态场景中使用，正式验收只读浏览，不发送消息、不运行付费CLI。

自动检查通过：`npm run check`（含类型、完整单元/集成与真实回调回归）、
`npm run format:check`、`git diff --check`、`npm run build:web:workbench`。
最终CSS额外重新通过ui-library/catalog检查，sidebar-row与sq-btn的matched-rules和catalog已刷新。

可重复执行证据：

- `scripts/test-conversation-two-pages-browser.mjs`：Chromium、Firefox隔离浏览器通过；
  含390px人员页和关闭后消息列必须占满viewport的几何断言。
- `scripts/test-thread-follower-profile-browser.mjs`：关注者指针/键盘、独立移除、响应式资料页通过。
- `scripts/test-agent-hover-navigation-browser.mjs`：最近动态和同Agent资料转动态通过。
- `scripts/test-conversation-two-pages-formal.mjs`：显式指定正式origin/database及已有Room/DM，
  使用只读请求白名单（另允许已发布头像GET和trajectory/list），不发送或编辑业务数据。

正式构建 `36c081642c1b2c8123e08f9daf0ffdd553cfa2f41c84b873faa564bfd821a50a`：
确认实例空闲后由restart-local-workbench守卫备份、优雅停止并重启；备份收据为
`/Users/sun/.rah/backups/pre-restart-0164a00c-efa7-4879-80bf-8a03bb638e99`。
重新打开正式页面验证了上述构建标识。正式Room/DM/Task浏览检查通过，未拒绝请求、无pageerror；
前后均为93条消息、6个Task、985个Room事件和4个Agent身份。

视觉截图已人工复核：`/tmp/rah-two-pages-formal-room-thread-agent.png`、
`/tmp/rah-two-pages-formal-dm-thread-agent.png`、
`/tmp/rah-two-pages-formal-room-settings-overlay.png`、
`/tmp/rah-two-pages-formal-room-task-person.png`、
`/tmp/rah-two-pages-formal-dm-human-390.png`及Task-modal桌面/手机图。
截图显示两页槽位、遮罩覆盖、完整手机人员页和独立Task模态布局。

本批是授权Raft源码对照、隔离真实浏览器及正式本地部署验收；没有进行新的同数据Raft在线
双边截图验收，也没有运行付费Provider、提交或推送。
