# 裸 @ / # 搜索目录与频道／关注边界

## 搜索大页

用户确认：trim 后仅为 @ 或 # 的输入是目录入口，不检索消息正文。
`search-visible-results.isDirectoryOnlySearch` 定义模式，SearchSurface 在该模式
禁用既有 useDiscoveryQuery 的 search 请求；该 hook 的 AbortController
负责取消前一次请求。渲染同帧忽略累计消息命中，避免旧查询闪现、污染数量。
人员／频道目录继续复用现有可访问目录，频道含归档；数量只计目录，不显示消息
分组或分页；空目录显示空状态。普通文字、@Kimi、#Solars 保持原有搜索行为。
搜索表单筛选保留，不因裸符号触发后台正文检索。

来源：2026-09-16 Raft 发布包 web-index.js 的 hxt 将 # 限定频道、@ 限定人员，
SHA256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`，
发布地址 https://app.raft.build 。沿用既有 SearchDestinationCard；原始 bundle
仅作分析，无逐字复制。本次裸符号不检索正文是用户明确采纳的产品规则，不把
hxt 的实体过滤函数夸大成 Raft 整个网络请求路径已完成双边验收。
Multica packages/views/search/search-command.tsx 没有本地 Room 目录与正文查询
的同一接口，复用 RAH 既有请求取消与目录 owner，未新增查询状态机。

回归先确认旧实现会提交裸符号 search 请求；修复后检查 @、#、带空白的裸符号
没有请求，带名称 #archived 仍有请求，旧请求晚到后目录数量与消息分组不污染。
桌面／390px 覆盖归档频道、目录点击；普通关键词计数使用既有双浏览器门。

## 频道资格与消息列／任务讨论关注

这是既有内核约束的核查与加固测试，没有改写业务语义：

- `CollaborationService.#normalizeRecipientIds` 对创建／回复逐个要求 Room 成员资格。
- `followAgentThreadParticipants` 在持久写入前再次 join 对应 Thread 所属 Room
  的 memberships，并要求 Agent 有效；频道外身份不会写入关注。
- `addRoomMember` 不新增已有 Thread 关注；只有显式提及／参与等既有入口能新增。
- task 审批讨论由 `chat-task-approval.tsx` 调用相同 thread.reply，不另有旁路。
- 移出频道后，已有历史关注记录保留但不再获得投递资格；重新加入只恢复已有
  关注资格，绝不因此关注此前未关注的消息列。本批没有扩大历史关系。

新增内核测试直接绕过 UI 验证外部 Agent 创建／回复被拒绝，底层关注写入也
无法越界，加入频道不新增关注，加入后显式追加才成功。测试使用临时数据库，
无真实 CLI 执行。

验证结果：9 项内核／搜索单测通过；裸符号及晚到响应桌面／390px 浏览器回归、
普通搜索双浏览器 8 场景通过。typecheck、正式构建通过；全仓 check 仍在既有
`/v1/worker/message-present` 未登记处阻断，format:check 仍有五个既存非本批文件。
持久状态备份、安全重启完成；新正式浏览器页的桌面／390px、刷新、目录计数、
无正文请求检查通过。没有修改真实关注关系或发送测试消息。
