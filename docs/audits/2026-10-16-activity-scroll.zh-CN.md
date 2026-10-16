# 官方动态滚动窗口、加载与空态对齐

## 来源与组合

核对官方 v1.21.16 发布文件 `https://app.raft.build/assets/ThreadsInbox-B_gHqypO.js`（既有 hash 见[返回专项](../evo/evidence/2026-10-16-activity-return/summary.json)），与冻结源码 `a98ae003246a0360872a77d76dec2fccd0347ef7` 的 `packages/web/src/components/thread/ThreadsInbox.tsx` 对照：滚动距离底部小于240px，且有下一批／未加载时调用 loadInbox；加载更多文案在列表尾部；初载使用 ConversationCardSkeleton，无内容使用 EmptyState；正文外层 p-4，卡片组 flex-col gap-2。保留原始 FSL-1.1-ALv2 通知、owner 授权和冻结源码，不修改官方原文件。

- **直接复用**：官方 ConversationCardSkeleton、EmptyState、MessageSquareText图标、原生翻译；既有 InboxRow移植保持不变。
- **结构移植**：240px阈值、加载保护、原始viewport／列表class、All／Unread／Mentions空态条件与文案。移除动态上的搜索结果总数／页码以及上下页按钮；搜索页继续原有组件。
- **本地接线**：`useActivityFeed`持有受限UI投影，调用既有 `activity.list`。20条一批、按稳定ID去重、保留已接受行；离开再返回只保存加载深度，重新从首页使用服务器新游标重建窗口后恢复位置。删除前一批的 `useActivityPages`，没有第二份游标栈或消息持久缓存。切换筛选／卸载取消旧请求，异步结果需通过abort检查才可写入。
- **本地兼容限制**：最多10批／200行，达到上限显示准确提示；这不是官方无限续页的完整等价实现。读取更多失败保留已读列表，停止继续自动请求，使用既有“刷新动态”重读；重复游标不循环。当前只支持后端已有all/unread/mentions集合，不伪造Done／Saved集合。
- 官方Inbox store仅在内存保留窗口，浏览器刷新不保留位置；本批同样不持久化。返回恢复来自新鲜读取，若期间排序／内容改变，像素位置可能对应不同卡片，未宣称持久锚点完全一致。

## 验证

TDD先复现上下页按钮仍存在；补充加载／空态用例先复现缺少官方骨架。四个纯读取窗口测试覆盖合并去重／稳定对象／上限、新游标重建、续页失败保留已接受行且不循环、结束／重复游标／批数上限。1440×1000与390×844，DPR1：实际指针滚动续页、首批保留、正文跳转与单次history写入、返回重读完整已加载窗口并恢复滚动、筛选变化回首屏、骨架与空态、16px容器间距。

早期测试在响应已结束后断言骨架，以及在筛选新响应到达前检查游标，暴露测试时序问题；改为明确控制初始响应释放、等待目标筛选响应，保留原断言。未通过延长等待或接受旧结果掩盖问题。类型／产品build、受影响source测试、格式／diff及定向浏览器检查；没有全仓后端或付费CLI。正式页面只读检查、截图与重启结果见[证据](../evo/evidence/2026-10-16-activity-scroll/summary.json)。

## 后续清单纠正

本批另核对当前发布主包 `app-shell-L7litFx-.js` 的 createTasks与多行创建对话框，和官方 `CreateTaskDialog.tsx`／`taskStore.ts` 一致：官方是一次 `/tasks/channel/:id` 提交多标题。Loom目前只有 `task.create`＋共享WriteIntentSlot逐项提交；尚未接入多行创建。不能把此项写成已存在通用的“任务批量改状态”，也不能直接把官方store接入成为第二个业务写入所有者。下一切片应复用官方表单，并为成功／失败／未知逐项衔接既有写入契约。
