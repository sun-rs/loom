# Human 成员权限刷新与行为登记纠偏

日期：2026-09-07（施工从 9 月 6 日开始）。仓库：独立 `rah_os`。

状态：本批已实施、验收并恢复正式实例；剩余边界见末节。单一工作 agent 实施并自测，不称独立审计。

## 已纠正的开发队列

原 B014、B042、B047、B054 分别把已有的 Room SOS、Computer Agent 跳转、Runtime inspector 和关系图
误记为缺实现或待裁决。现在原 ID 保留，补入真实 owner，并改为待完整验收。
B043 则明确区分已实现的诊断复制与未闭环的恢复操作。没有将它们直接升级为 verified。
README/docs 索引中 full reset 仍仅设计、Task 正式实例尚未恢复等陈旧表述也已修正。

## 问题与最小修复

1. App 曾单独读取一次 control Room membership 作为 Workspace 权限，此后成员目录虽会刷新，
   管理按钮却仍使用旧角色；旧请求成功分支还缺少 abort 判定。现在删除该独立读取和 state，
   所有 Workspace 管理入口直接消费已有 `workspace.human.list` 有界、按范围对账的投影。
   读取失败时不沿用旧管理权限，后端仍对每次操作独立鉴权。
2. 成员目录失败原先表现为零人或无反馈。现在显示读取状态、明确错误和重试；被截断的目录标明
   前 500 位，不能把截断长度当完整人数。
3. 打开的 Human profile 原先只因 Agent catalog revision 等变化重读，其他页面修改 Human
   角色后不会自动更新。现在订阅现有目录中目标 Human 与当前 actor 角色的变化，沿用原读取
   hook 的 scope/abort 保护，不另建轮询或身份缓存。
4. 角色编辑在失去 owner 权限时立即收起，键盘提交也校验同一权限。取消和成功保存后按 React
   渲染生命周期还焦；后台同范围 refresh 保留已有投影和编辑器，只有真正 scope 改变才清空。
   Human pane 的实例身份包含 Workspace、actor 和目标 Human，旧主体请求不能污染新主体表单。
5. 已打开的 Agent 创建菜单也随创建权限撤销而关闭，避免留下失效的可点击入口。
6. Human 手机标题栏误用了 Agent 专用的 76px 变体；改为既有 surface 变体，桌面和手机均为
   官方实测的 62px，不新增页面 CSS 覆盖。

后端协议、Kernel 状态机、SQLite schema 和 Agent memory 均未改变。沿用既有 owner-only
角色写入、最后 owner 保护、幂等与 causal barrier；本批不加入 Human 邀请或全 Workspace 删除。

## 来源与可比范围

- 授权冻结 Raft `HumanDetailPanel-DvWNsDz9.js`，SHA-256
  `83c31367e48dc1ff6fb75c763ae78fafe16070d53e7d4d58ba16303f7c49bceb`。
- 本轮亲自打开官方 `app.raft.build`，当前入口为 `index-BVfbaScj.js`，只读检查成员列表、本人
  资料、描述编辑/取消、角色说明/Escape 和 390×844 布局，没有修改官方资料或发送消息。
- 官方实测桌面 1440×900、手机 390×844，DPR 1、scale 1；标题 16px/20px，桌面描述编辑按钮
  12×12px，手机标题栏 62px、document scrollWidth 390。官方只有一个 Human，不能证明多 Human 权限切换。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
  `server/internal/handler/workspace.go::UpdateMemberRole` 提供修改后失效 membership cache、
  last owner 保护的参考。未复制 Go handler、中央邀请或其权限状态；RAH 使用既有 canonical owner。
- 有意差异：RAH 保留严格 owner-only 角色编辑，不制造中央邮箱/邀请字段；本人 DM 入口与官方
  不同；角色说明关闭后的还焦也保留本地可访问性行为。上述差异没有被算为完全一致。

## TDD 和浏览器业务证明

首个有效失败收据：`rah-human-membership-cB8vo9/receipt.json`，真实 API 已将当前 Human 降级，
旧 App 8 秒内仍未禁用管理入口/关闭角色编辑。更早失败来自夹具字段与定位器，不能当产品反例。
修复后该反例通过。随后保存焦点测试失败于 `rah-human-membership-B2DTh0/receipt.json`，
促成同范围 refresh 保留投影及渲染后还焦修复。
手机标题栏反例为 `rah-human-membership-d2HdHf/receipt.json`（76px 而非 62px）；
失权后已打开的创建菜单反例为 `rah-human-membership-fEtZ2D/receipt.json`。均先复现再修复。

新增 `npm run test:web:human-membership` 使用独立临时数据库和 Fake CLI，创建三个 canonical
Human。与正常 foundations fixture 分开启用，不更改正式用户身份或调用付费模型。

场景覆盖：

- 当前 actor 从 owner 分别降为 admin/member，编辑器消失，后端仍以 403 拒绝角色变更；
- 桌面/390px 的角色选择、Escape/成功还焦、canonical 保存、后台更新和 URL reload；
- 目录 503 的真实错误反馈、重试和管理禁用；
- 服务端接受角色变更后故意丢失响应，切换另一 Human，旧请求错误不污染新资料；
- 最后 owner 降级被 409 拒绝，独立 API 读取仍为 owner；
- Human DM 真实创建 direct Room，独立读取仅含两名 Human，不发送消息或触发模型。

场景使用精确输入快照生成收据，并在结束时校验文件集合与逐文件 hash。故障注入只模拟读取或
传输失败，不把假成功返回连接到生产。浏览器请求受隔离来源和声明路由约束。

## 最终交付

证据归档在 `/Users/sun/Code/reviews/rah_os/2026-09-07-human-membership`。

- `npm run check`、`npm run format:check`、`git diff --check` 通过。
- `npm run build:web:workbench` 通过，冻结 Web build：
  `e04d22290c575566a369aa941805437baf4fd83713a6e3b3f5d2aff7ce193aff`。
- Human 专项：`rah-human-membership-YNHPKu/receipt.json`，Chrome/Firefox × admin/member
  四组通过；foundation 最终收据 `rah-ui-foundations-5oE10f`（Chrome 14 场景）、
  `rah-ui-foundations-OP7bEl`（Firefox 14 场景）。逐文件 hash 与最终源码再次核对一致。
  历史失败仍保留，见末节，不把重跑当问题根治。
- 正式重启前确认无活跃执行，原 PID 67230 经验证备份后优雅退出；新 PID 6386 独占 4173。
  备份为 `/Users/sun/.rah/backups/pre-restart-625a2adc-5943-4977-a37c-c13ca763a78c`。
- 正式持久实例的 discovery 与 Settings 浏览器门禁在 Chrome/Firefox 均通过，返回同一 build。
  分别归档 `rah-discovery-formal-xMbccA`、`rah-settings-formal-TcnGIQ`。
- 正式 Human 资料额外以归档的 `formal-human.mjs` / `formal-human-receipt.json` 检查：
  两浏览器的桌面/390px、62px 标题、无横向溢出及真实 URL reload 均通过，无业务写入。
- `state-preservation.json` 对比备份和重启后数据：6 principals、6 rooms、43 messages、2 tasks、
  378 events 内容一致；4 Agent 定义/35 revisions、4 runtime profiles/31 revisions 及 3 memory
  homes 一致，Agent 私有记忆文件逐字节摘要一致。没有用 Fake fixture 替代正式地址。

正式用户入口为 `http://127.0.0.1:4173`。锁屏使本轮重启后的 CUA 人工操作不可用；已执行真实
headless Chrome/Firefox 页面验收并查看截图，不能称为解锁后的人工点击验收。

## 剩余边界

- 本批关闭的是 Human 身份/角色刷新及所列交互组合，不代表 Agent 所有 tab、成员侧栏折叠/
  拖拽或完整 Administration 均已与 Raft 对齐。
- 官方多 Human/non-owner 及失权状态没有相同前置，保持待验证；本地 3-Human 场景不能替代。
- 跨 Workspace 中途切换与全部凭据撤销组合不能从旧主体切换用例推导为通过。
- 现有通用 formal browser guard 把 Human 读取登记成旧的 `/humans/profile/get`，且未包括
  `/agents/get`；专用正式 Human 验收额外精确声明了 SDK 中这两个实际只读路径，未放开写操作。
  将该专项并入仓库常驻正式门禁仍待完成，不能用 Settings 门禁代替 Human 正式验收。
- 首次累计 foundations 中 Firefox 在 1,001 条 active Task 续页时报 `out of memory`，随后同断言
  单独运行 Firefox 全部 14 场景通过。未改 Task 实现或降低规模；原因尚未确定，保留失败收据
  `rah-ui-foundations-wR6gNN`，并将重复运行的大列表内存稳定性列入后续可靠性检查。
- Chrome 累计回归曾在 Room 首次导航后的标题栏测量时得到空 bounding box，失败采样时标题栏已
  可见且无 page error（`rah-ui-foundations-8S48ZP`）。保留时序失败证据，不归因于本批 Human
  修复，也不据重跑通过宣称该瞬态问题已根治。
- 本地 Human 邀请、全 Workspace 移除与凭据生命周期仍待独立产品裁决。
- 没有提交、推送、发布外网或运行付费 Provider 门禁。
