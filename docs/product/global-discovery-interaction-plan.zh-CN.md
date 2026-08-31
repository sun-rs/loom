# Tasks / Search / Activity 交互对齐与本机交付计划

2026-08-30。先检查官方代码和登录页面，再实施；不扩大到 Files 或远程 Computer。

## 来源与纠偏

官方 `raft-ui/vendor/raft/index-WTraJnrd.js`（上批 SHA-256 固定）提供：

- `Zd` / `V9e`：选择弹层 220px 最小宽、2px 边框、8px 偏移、36px 选项、256px 滚动区、标题/搜索/清除、选中勾及禁用态。
- `HG`：Tasks 多选，自己/未分配置顶；Search 发送者与频道是单选并关闭，范围是 `mentioned/humans/agents` 多选，不是会话类型。
- `MN` / `RN` / `uat` / `fat`：范围标准化、人类和 Agent 同选等同不限制类型、时间 any/today/7d/30d、空关键词筛选用 recent；选择发送者与范围冲突时清掉冲突条件。
- `Ytt` / `Wtt` / `Vie` / `wnt` / `xnt`：状态菜单、状态列拖放，MouseSensor distance=5、TouchSensor delay=200/tolerance=5，状态在服务端成功后更新。复用上游同款 dnd-kit，不自写指针拖拽引擎。
- 搜索消息的 relevance 算法在 Raft server，不在发布包；不能声称提取了不可见的排序源码。本轮对齐排序选择、空查询、稳定分页与范围。当前关键词按字面匹配，排序为精确/前缀/包含；未增加模糊、多词分词或语义检索。

## 所有权和安全裁决（施工前复审）

1. 选择弹层由共享 Web 组件拥有；同一时刻一个弹层、Esc/外点/滚动定位/失焦、键盘选择；不增加移动端第二套行为。
2. Search 过滤与顺序由 Kernel 拥有，追加 senderKind / mentionSelf 过滤，保留旧 API 的会话类型 scope；Web 的 scope 改为官方人物范围含义，不承诺旧会话类型 URL 的语义兼容。跨页面清除不属于目标页面的过滤，Search 频道/发送者链接归一为单选。空查询在有过滤时返回消息。时间窗口固定到本次查询/游标，不在每次渲染中滚动边界。
3. 全局 Task 操作复用既有 canonical cancel/reopen/complete/assign 命令与 Room 同步屏障。不能以全局看板当前 Room 的 sequence 修改另一个 Room，也不能让旧卡片覆盖新状态。
4. 保留 ADR-0021/0022：未提交/未通过审阅不能拖成完成；取消需原因并执行 Runtime fence，重开需 terminal proof；进行中/待确认是 Agent 执行事实，不允许 Human 拖拽伪造。不可操作目标显示原因，菜单和拖拽共用裁决，不用视觉乐观更新掩盖失败。
5. 不复制 Raft `vZe => true` 的宽松写入许可。其完整任意状态图与 RAH 当前业务保护有明确差异，这是有意保留的保护，不是声称全部 1:1。
6. 真实浏览器使用隔离 fixture（fake CLI 仅验证产品链），官方侧不修改用户现有任务。通过全仓门禁、正式状态根和 workspace 确认后，再启动/重启 4173，保留所有持久身份与数据。

## 顺序与退出条件

- 先补 Search 范围/空查询/排序分页及跨 Room Task 操作反例。
- 共用弹层，补全部本批筛选（含负责人筛选）、状态菜单及安全确认；Room Tasks 复用同一弹层，未新增全局卡片的负责人改派菜单。加入 dnd-kit 与失败恢复。
- 1440×1000 双边弹层结构/状态对照；本地真实拖拽、刷新持久化、拒绝危险转换、390×844 和键盘回归。
- `npm run check` / format / production build / dependency audit / diff check；记录真实部署版本/入口和未测边界。未达标不声称收口或替换用户服务。
