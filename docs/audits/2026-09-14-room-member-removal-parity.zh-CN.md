# 成员悬停、移除确认与权限差异

本批为源码支持的结构移植及 RAH 文案修正，不是上游源码的字节复制，也没有修改成员移除后端。

## 来源与规格

分析来源为 Raft 发布的 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
授权分析副本在 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`；生产不依赖该目录。
沿用已有 provenance/notice；没有新增上游资源或修改冻结快照。

- `zg`（pretty 139252）：成员行左右12px、上下8px，名字14/20px、Agent字重500；
  次行12/16px、黑色50%。头像28px、上偏移4px；普通两行成员高52px。
- `hover:bg-soft-signal/30`：黄色 `#ffd440` 的30%透明度。
  内部 `--soft-signal` 已带30%透明度，旧实现再次混合30%，实际黄色过淡。
- `zD`（139350）：移除按钮高28px、字号12px、行高16px、左右padding8px；
  `#f97264` 默认20%、hover60%，叠加到黄色成员行上。
  原有 `.rah-member-row .btn` 覆盖了字号和padding，本次用成员页作用域解除覆盖。
- `act`（150362）→ `Ki`（107310）：移除确认 `actionSize="xs"`、默认red。
  `zGe.xs`：按钮24px、11px字体、左右8px、leading-none。
  保留共享确认框384px宽上限、24pxpadding、18/28px标题和14/22.75px正文。

## 语义差异及单一 owner

Raft 中文资源（71098）明确说明：移除后停止常规消息与发送，已有关注不自动取消，
已关注的公开消息列仍可通知被移除者，私有内容继续受权限限制。
这是前端产品契约证据；没有取得 Raft 中央服务器内部实现，不能声称完整核实其事务副作用。

RAH `CollaborationService.removeRoomMember` 是唯一成员移除 owner：

1. 现有管理权限、因果序号、幂等键、最后所有者约束继续生效。
2. 在本 Room 有未完成任务、待回应输入、排队/运行 Activation 或活动进程时拒绝移除。
3. 在现有 RoomKernel 事务中追加 `membership.removed` 并删除 membership；不删除 Agent 身份、
   私有记忆、历史消息或关注记录，也不自动停止其他 Room 的执行。
4. `agent-thread-subscriptions.ts` 的投递查询始终连接当前 membership。
   因此离开后普通消息和关注消息列都不能继续投递，读取也被现有访问检查拒绝；
   重新加入后保留的关注记录重新具备投递资格。

遵守[单 Human 主线范围](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)：
非成员公开频道访问/关注属于延期范围。本批不放宽 Agent membership fence，不把 Raft 的
公开消息列例外写成 RAH 已有能力。确认文案准确说明“已关注的消息列也不会继续通知”，
以及历史和关注保留、重新加入后按权限恢复。文案长度不同导致弹窗高度随内容变化，
不能宣称两套不同权限语义的弹窗整图像素相同。

## 验证

- 浏览器先新增颜色、几何及文案断言，确认旧悬停颜色失败，再修改实现。
- `test-room-member-layout-browser.mjs`：Chrome/Firefox，1440×900及390×844；
  行hover、按钮hover、移走隐藏、键盘聚焦显示、28px/12px规格、52px成员行、
  24px红色确认动作、取消、失败重试、成员资料返回和添加页均通过。
- `agent-thread-subscription.test.ts` 增加真实临时 Kernel 回归：移除后读取拒绝、
  消息列投递为零、幂等重试、重新加入后原历史仍可读且关注恢复投递。
  与 `collaboration-business.test.ts` 共7项通过，既有活动工作拒绝断言保留。
- `test-channel-settings-browser.mjs` 通过。

以上为源码参数与隔离浏览器验证；未在真实 Raft 空间移除成员，未运行付费CLI。

## 交付检查与正式服务

本批 `npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 通过，共享 sidebar-row/sq-btn 规格证据与内部 catalog 已刷新。

正式重启检查发现仍有 leased Activation，因此按既有 restart guard 保留正在运行的服务，
不终止 Agent 或强制修改执行状态。新浏览器验证当前正式首页正常响应，仍使用旧构建
`e523e2194c3ef22c6115c53addf6bb25fb61b9b9e52515f9f6d0cc07812f9425`。
本批候选构建 `b5324e3f338385923e0468a7ec0e75f684875a6e366e63424ba2e0a0d9afbcfb`
已完成构建和隔离浏览器验证，正式重启与新页面验收尚被活动执行阻塞。
未在正式频道确认移除任何成员。

## 添加成员搜索占位更正

按用户本轮更正，添加成员页面占位改为“名称”；成员管理页面继续为“搜索成员...”。
这取代此前频道设置审计中关于添加页占位的旧请求。两个视图仍共用同一搜索行为。
专项浏览器断言先确认旧占位失败，再验证更正后的添加页占位。

本次占位更正的专项浏览器与正式构建通过；本次重新执行全量检查时，工作区随后加入的
`.rah-thread-search .sq-btn` / `svg` 尚未登记到共享按钮规格，且 CSS 摘要已经变化，
`check:ui-library` 因而未通过。格式检查另外报告 `identity-interactions.css`。
这些结果不计为本轮全量检查通过，也不覆盖前一批已完成的检查记录。
正式实例最初有活动执行，最终复查已经空闲；但本轮全量检查仍被上述工作区检查问题阻塞，
因此未重启，页面占位尚未在正式实例生效。

## 正式生效复核（本轮最终状态）

前述阻塞已解除。Thread 搜索中既有28px按钮/14px图标的两条规则按 Raft
`thread-search-bar`（pretty 165079–165104）补入共享规格，刷新 CSS 摘要和 catalog；
没有改变其搜索行为，也没有增加未知来源的例外。全量 `npm run check`、格式与diff检查、
正式构建以及 Chrome/Firefox 成员页桌面/手机门禁再次通过。

正式服务已在空闲检查与持久数据校验备份后正常重启，最终构建：
`423b10bc7a73193297e5c22cb847abbf4cdce8fa64d61cce5b7a99b5d7a722e0`。
首轮本机浏览器检查通过，但 LAN 校验发现启动环境未沿用既有 Tailnet 模式；
已携带原 `RAH_TAILNET_HOST` 再次执行同一备份/正常停止流程，恢复原有三种入口。
最终备份为 `/Users/sun/.rah/backups/pre-restart-a152fccc-653d-486b-bf89-7a8bde9a7e25`。

正式真实成员页验证了黄色行hover、按钮28px/12px与20%→60%颜色变化；
弹窗384px宽、24pxpadding、2px边框、18/28px标题、14/22.75px正文、24px红色动作；
取消后成员仍在，添加页占位为“名称”，刷新后页面正常。本机、LAN、Tailnet均以新浏览器
核对构建身份通过。未点击正式确认移除、未发送测试消息或启动付费模型测试。
