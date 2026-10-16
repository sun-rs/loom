# 搜索常用对象与动态页窗口返回

## 官方实际锚点

已逐项核对官方 v1.21.16 发布包 `app-shell-L7litFx-.js` 的 `vxt` 排序、`search-entity-usage-store:v1` 与 `search-frequent-heading` 组合，和冻结源码 `a98ae003246a0360872a77d76dec2fccd0347ef7` 一致。URL、SHA256见[发布证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)。来源为 `packages/web/src/components/search/{MessageSearchPage,SearchHomeEntityRow,searchHome,useRecentConversationEntities}`、`store/searchEntityUsageStore.ts`。沿用原始 FSL-1.1-ALv2 通知与 owner 非商用授权；未修改冻结源码。

- 直接复用官方常用条目组件、usage store、排序函数；结构移植完整页常用 section 原始 class、图标、文案。Loom glue 仅提供 workspace/Human、认证目录和隐藏私聊键映射；未接实例在线状态，因此不伪造活动点。
- 常用只记录从搜索打开的目的地；普通频道访问属于最近对话，不增加搜索频率。实体打开记录放在成功导航路径，拒绝、未决私聊和过期异步导航不提前计数；普通消息搜索命中按所属目的地记录，线程命中不计入。
- 原生时间衰减、数量上限、归档／失效／隐藏目的地排除及存储失败容错直接复用。常用卡片沿用普通搜索打开路径：桌面详情、窄屏完整对话。历史词清除不清除常用；空查询浮层保持最近对话，不加入常用网格。
- 官方 `ThreadsInbox.tsx` 的 savedScrollTop、loadInbox 与 `store/inboxStore.ts` 是内存窗口；store没有persist包装。官方按滚动续页，这次没有把 Loom 现有20条上下页说成官方滚动续页。兼容修复只保存同一客户端、工作区／筛选的分页游标栈，返回后重新授权读取该页，随后恢复滚动位置；筛选变化清空位置与页窗口。没有缓存消息正文，也不增加业务真相来源。
- 浏览器刷新后保留动态位置不是上述官方实现，未添加；独立顶栏历史宿主仍未确认完整组合，未自造控件；官方滚动续页与当前显式分页的差异仍保留为未完成。

## 定向验证

先运行新增断言：常用卡片缺失失败；动态第二页返回误到第一页失败。修复后1440×1000、390×844，DPR1：搜索打开后卡片出现、两次打开优先于一次较新打开、卡片实际导航、刷新保留、清词历史不清常用、浮层无常用网格；动态第二页进入正文／浏览器返回重新请求第二页，网络加载后恢复滚动，换筛选归第一页顶部。只测受影响搜索历史／动态返回切片，未跑全量后端、综合浏览器或付费CLI。

[机器证据及部署结果](../evo/evidence/2026-10-16-search-frequent-return/summary.json)。真实页采用临时profile、只读搜索验证新build、常用空态和两种尺寸布局；常用目的地激活与多页返回的完整链路来自隔离测试，不声称在用户数据上制造了对应场景。
