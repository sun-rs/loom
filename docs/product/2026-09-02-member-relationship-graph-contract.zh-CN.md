# Workspace 成员关系图 Raft-first 合同（2026-09-02）

## 1. 裁决

成员关系图不是把当前 Room 成员画成一排，也不是根据消息内容猜“谁和谁关系好”。
Raft 的真实数据语义是：**同一成员出现在同一可见 Channel 中，就形成一条共享频道
关系；边的权重等于共享频道数。** RAH OS 结构化移植这个 read model，但继续以本地
Workspace ACL 为边界。

本批只做只读关系投影、交互和 typed deep link；不增加社交评分、模型推断、消息正文
分析或关系写入。

## 2. 冻结上游

- 文件：`docs/evidence/raft-web-20260831-current/MemberGraphSection-C1stxx0a.js`
- SHA-256：`0913095ac9ca8b0c0b95fee0df026674f852c9daf61669bd6347ef616121059e`
- 服务请求：`GET /servers/:serverId/member-graph`
- UI 组件：graph viewport、node hover card、refresh、摘要卡和 SectionHeader。

可逐项复用的合同：

1. 数据包含 Human、Agent、Channel 和成员的 `channelIds`；
2. Channel 按 `memberCount desc, name asc`，成员按显示名排序；
3. 先排除名称 `all` 且成员数大于 36 的 Channel；若没有任何边，再回退到所有非
   `all` Channel；
4. 共享 Channel 生成无向边，权重为共享 Channel 数；
5. 节点显示头像、名称、连接数，hover 延迟 200 ms、关闭延迟 120 ms；
6. 支持 pointer/touch 拖动、滚轮/双击缩放，缩放范围 `1..4`；
7. 空数据、loading、warning、refresh 都是显式状态；失败保留上次成功投影；
8. 右栏显示 Human/Agent/link 计数、连接最多的 6 人、最大的 6 个 Channel。

## 3. 本地 ACL 与数据合同

Raft 发布前端不能证明 Server 的 ACL SQL。RAH OS 的 canonical owner 必须满足：

- 请求只接受 `workspaceId`，actor 从认证上下文取得；
- 只纳入该 Human 当前可读取且未归档的普通 Channel；Direct/control Room 不产生边；
- Human 与边仍来自上述 Channel 的当前成员；Agent 节点同时纳入既有 authenticated
  Agent catalog 可见的同 Workspace 身份，即使没有共享 Channel；不扩大目录可见权限；
- Agent node 同时带 `participantId` 与 `agentDefinitionId`，Human node 只带
  `principalId`；浏览器不从显示名反查身份；
- node/channel/link 数量有上限，超限显式截断或失败，不能返回无界 Workspace 图；
- 关系图是查询投影，不写 Room event、不唤醒 Agent、不占模型上下文。

## 4. 单一 owner

```text
protocol MemberGraph schema + Raft edge projector
  -> Kernel workspace-member-graph ACL-safe SQL projection
  -> Human application port
  -> /v3/client/workspaces/member-graph
  -> RahClient workspace.memberGraph.get
  -> MemberGraphSurface（Raft structural port）
```

Web 只负责 official geometry、pan/zoom、hover 与摘要；不得自行跨 Room 拉取成员后
拼图。冻结 Raft 组件把 node 渲染为 `cursor-default` 的 hover 目标，并没有 node 或
Channel 点击导航，因此本批不发明点击行为，也不创建公开分享 URL。

## 5. 路由与交互

- `?surface=agents&memberView=relationship` 是 reload-safe 内部 deep link；
- 普通 Agent 详情仍为 `?surface=agents&agent=:id&agentTab=:tab`；两种 view 互斥；
- 左侧“关系图”按钮可 pointer/Enter/Space 打开，选中态与 Agent 行一致；
- Escape 不退出页面；hover 卡 Escape/外部 pointer 按共享浮层协议关闭并还焦点；
- node 仅承载 hover/focus 摘要，不把点击伪装成资料页或 DM 导航；
- 手机使用同一 read model，图和摘要纵向排列，不生成第二套行为。

## 6. Failure-first 与发布闸

必须先失败、再实现：

1. protocol 拒绝未知字段、重复 node/channel identity、无效类型和无界集合；
2. Kernel 证明不可见/归档/direct/control Room 不进入图，边仅来自可见 Channel，目录可见的零连接 Agent 仍保留；
3. 两个共享 Channel 只生成一条边且权重为 2；无共享 Channel 的成员仍是孤立 node；
4. HTTP/SDK 路由严格绑定 actor 与 workspace；
5. URL reload/back/forward 在 relationship 与 Agent detail 间稳定切换；
6. refresh failure 保留旧图，late response 不能覆盖新 Workspace；
7. desktop 与 `390×844` 实测拖动、滚轮/双击、hover/focus、空态、错误态、
   刷新和无横向溢出；console error/warn 为零。

证据仍分 `C/A/L/R/D`。`R` 只覆盖冻结 bundle 的数据 shape、过滤/布局/交互；Kernel
ACL SQL 是本地安全 glue，不冒充未公开 Raft Server 源码。

## 7. 施工与验收记录（2026-09-02）

- upstream：冻结 `MemberGraphSection-C1stxx0a.js`，SHA-256
  `0913095ac9ca8b0c0b95fee0df026674f852c9daf61669bd6347ef616121059e`；采用
  shared-Channel edge projector、`920×560` 画布、`1..4` zoom、`200/120 ms`
  hover、刷新保留旧投影与摘要结构。没有采用消息分析或模型推断。
- reuse class：Raft 前端与 projector 为 structural port；认证 Human、Workspace ACL、
  archived/direct/control Room 排除、上限与 SQLite 查询为 RAH local-first glue。没有找到
  需要优先采用的 Multica 模块。
- single owner：`member-graph.ts` protocol/projector →
  `workspace-member-graph.ts` Kernel projection → Human application port →
  `/v3/client/workspaces/member-graph` → SDK → `MemberRelationshipGraph`。Web 不跨 Room
  拼接数据。`AgentAvatar` 已抽成共享 owner，关系图与 Agent 目录使用同一官方头像投影。
- failure-first：protocol 重复/越界/未知字段，Kernel ACL/direct/control/archived，HTTP/SDK，
  route mutual exclusion，layout deterministic/bounded 与组件 owner 测试均先失败后转绿。
  `RoomKernel` 未提高源码体积 ratchet；SQLite transaction helper 被抽为单一小 owner。
- automated evidence：完整 `npm run check` 通过；两个 opt-in 真实付费 Provider 用例按规则
  skip；Web `169/169`、parity regression `34/34`。`format:check`、
  `git diff --check`、trusted workbench build 与 `npm audit --omit=dev`（0 漏洞）通过。
  Chrome 完整门禁与 Firefox 150 desktop/`390×844` 门禁均通过。
- deployment evidence：正式状态 Task/InputRequest/Activation/Run/Runtime/lease/SOS/
  reassignment 均为 0；Room 与 Runtime Registry 的 `quick_check=ok`、外键检查为空。
  26 条未发布的历史 `placement.ready` 是无 lease/无尝试的 content-free wake hint，不是
  active work。owner-only 在线一致性备份为
  `pre-member-graph-20260902T082518Z`（787,615,744 bytes）。旧 PID `59686` 优雅退出，
  新 PID `9820` 在 `127.0.0.1:4173` online。
- formal browser evidence：reload-safe deep link 保持 relationship view；正式 ACL 投影显示
  `1 Human + 2 Agent`、3 条共享 Channel 边（Workspace 目录中的另两名 Agent 没有可见
  Channel 关系，因此正确保留在成员目录而不进入图）。实际测得 viewBox `0 0 920 560`；
  200 ms hover 显示身份/连接/Channel，Escape 关闭；滚轮 zoom 与 pointer pan 均改变
  viewBox；选择 Agent 回到资料页。`390×844` 的图、返回入口和成员列表闭环通过，
  `scrollWidth=390`；console error/warn 为 0。

结论：`C/A/L/D` 完成；`R` 完成冻结 Raft 发布物可证明的 projector、组件和交互合同。
未取得的 Raft Server ACL 实现没有被冒充为源码移植。

## 8. 2026-09-10 Chrome 对照纠正

Chrome 同视口证据 `2026-09-10-chrome-bilateral/chrome/22-graph-raft.png` 中官方图保留
零连接 Agent。第 7 节“另两名 Agent 不进入图正确”的历史验收结论撤回。Kernel 沿用
`listAgentCatalogRows` 的 control Room 认证范围补齐目录可见节点；边仍只由可见、未归档
频道成员关系形成。没有增加多 Human 权限或非成员频道读取能力。

界面复用共享 `PanelHeader`，恢复标题和 EXPERIMENTAL 标签，以及独立关系数量/刷新行。
图内默认 Human 头像原输出 `.rah-settings-avatar` 未命中图的头像规则；现在与 Agent 均为
36px 圆形，摘要和侧栏仍使用紧凑头像。布局参考冻结 MemberGraphSection 的 `space-y-4`、
`xl:grid-cols-[minmax(0,1fr)_280px]` 和 `md:h-[520px]`；标签视觉来自上述 Chrome 图，
不将截图测量称为源码提取值。

聚焦回归：Kernel 真实临时账本先验证空频道图仍包含全部目录 Agent（修复前 0 != 3），
再验证加入频道后零连接节点保留且没有伪造边、不可访问 Workspace 仍拒绝；Chrome fixture
先复现 Human 18px 方块，再验证 1280/390 视口双方图节点 36px 圆形、标题/数量分离、无横向溢出。
此处是隔离浏览器回归，不代替正式构建重启或重新双边验收。
