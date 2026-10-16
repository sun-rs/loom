# 搜索频道与实例候选

## 来源、授权与组件链

本批继续以官方 v1.21.16 发布代码为锚点，原始 TSX 来源仍为已取得的 `a98ae003246a0360872a77d76dec2fccd0347ef7` 快照。发布文件 URL、版本与 SHA256 见[前批来源证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)。负责人允许非商用复用；保留原许可证、声明和原始文件摘要，不宣称取得新版原始 TSX。

- `MessageSearchPage.tsx` 的 entitySearchEntries／rankedEntityResults → 直接调用原生 `buildSearchEntityEntriesWhenQueryPresent`、`filterSearchEntityEntriesForQuery`、`useRankedComposerSuggestions`，包含原生拼音／模糊排序与 worker 路径。不自编另一套名称搜索。
- 原生 `findExactDestination` → 浮层精确频道名／实例名／handle 优先，全结果操作随后；非精确查询保持全结果操作在首行。限定 `#`／`@` 的实体类别规则直接复用。
- 原生 `EntityResultRow` → `SearchEntityResult`、头像、Badge、颜色、归档标识和选中样式直接复用。保留原生标题／说明／徽标结构，不引入新卡片。精确候选与全结果共用官方 `mb-3 flex flex-col gap-2` 组合；浏览器验证间距8px。
- `MessageSearchPage` selectableResults／深链接同步 → 本地 `useSearchRail` 结构适配为实体、全结果、消息的统一稳定身份序列；不是原文件逐字复制。鼠标与键盘共享选择，查询变化／精确匹配到达重置浮层首行，完整页刷新同步已打开频道。

## 数据与导航的唯一所有者

`search-entities.ts` 仅把认证 `room.list`／`role.list`／`agent.list` 转换为原生搜索候选。只展示可访问频道及该目录下仍有成员关系、未 tombstone 的 Role 实例；不展示 Role 配置本身、legacy persona、Side 或其他计算机。名称取实例实际冻结修订，不采用当前 Role 名称；Role 删除不使仍存在的实例消失。已归档频道保留原生归档样式。

目录在搜索页挂载时读取，输入变化只在本地重新排序，不逐键重新读取目录。目录失败独立提示和重读，不阻断消息搜索。卸载取消请求，未使用官方 store 作为第二业务真相。实例卡片不渲染官方 store 的活动点，避免把缺失数据伪装成离线；真实运行状态仍在已有实例侧栏。

`useSearchDestination` 只组合前端路由：频道打开前重读可访问目录；实例使用已有私聊，必要时交给现有 `LoomPrivateBoxClient` 和同一个 `WriteIntentSlot` 创建。没有新后端端点或第二写入队列。未知结果由既有“核实打开私聊”处理，重放同一 payload／依据／幂等键；不会静默重发。后到响应只有在发起路由和请求仍有效时才导航。

桌面完整页单击在右侧打开；双击、手机及浮层直接进入聊天。URL 只传稳定 Room ID，不伪造消息定位；刷新可恢复右侧正文。候选加载或打开失败保持搜索，旧页面草稿沿用现有背景路由与桥接所有者。

## 验证与剩余边界

测试先确认缺少候选组件／数据适配，再实现。组合间距16px而非8px、非首条频道刷新后未选中均先由浏览器复现。1440×1000和390×844验证频道候选、实例私聊、精确／部分匹配、原生8px间距、刷新恢复；桌面模拟服务端成功而客户端丢失私聊响应，核实请求与原请求完全相同。另复验顶栏草稿／IME／消息定位及搜索追加／动态详情导航；只跑受影响检查，不跑全仓或付费 CLI。

仍未接入实体候选的频道右键菜单、最近访问／频率记录、计算机／多人候选及可拖动浮层。搜索默认空态仍为既有简化空态；不把本批称为搜索整页完全移植。动态已完成集合缺查询能力的边界不变。部署与真实页面证据见[本批记录](../evo/evidence/2026-10-16-search-entities/summary.json)。
