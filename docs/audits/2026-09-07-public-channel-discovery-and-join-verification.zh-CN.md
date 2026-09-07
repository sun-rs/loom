# 公开频道发现与本人加入：后端增量验证

本批只修改 `rah_os`。实现范围是公开频道元数据发现和认证 Human 自行加入；
没有将公开频道完整页面族标记为完成，也没有修改 Agent 执行、记忆或 Provider。

## 来源与设计

[设计合同](../design/public-channel-discovery-and-join.md)记录授权 Raft 冻结 Web bundle
的文件、SHA-256 和加入控件位置。官方服务端未知，本批是 RAH 自有 Kernel glue，
不是复制 Raft 服务端。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`
没有找到同义的 Human public Channel self-join owner，没有移植其 connector Channel 模型。
解锁后官网真实 Search 输入 test 可看到频道及消息结果；没有在官网执行加入/退出，
这项观察不等于同前置条件的完整双边验收。

现有公开频道创建会加入当前 Workspace Human，本批保留该行为，补上退出后重新加入能力。
目录按 Room ID 有界翻页，每次重新检查当前 Workspace membership 与频道公开/归档状态。
加入只接受本人认证身份，固定 member，复用 membership.added event 和 Outbox。
旧 Room sequence 被拒绝；重复原请求不会重复写事件；退出/重新加入后不能复用更早的意图。
没有新数据库迁移、第二套队列或投递状态，原 history/文件/Task/Agent 门禁不变。

## TDD 与验证边界

先以缺少 Human port 方法及 HTTP 404 记录失败，再实现 Kernel owner 和 typed facade。
Kernel 测试覆盖分页、过滤、Agent/外部身份、私密/direct/control/归档拒绝、权限撤销、
状态变化、角色冒充、跨身份 key、退出后重试、持久化重开、事件写入失败事务回滚。
加入只产生一条 Room event 和 Outbox，不改变 Inbox、Activation 或 delivery cursor。
HTTP/SDK 测试验证同一 authenticated owner；Agent token 由既有 Human auth 拒绝为 401。
所有业务写测试均使用临时数据库与假时钟，没有使用正式用户数据或付费 CLI。

完整检查和正式重启结果在下方交付记录追加；代码实现不等于真实 CLI 或官方双边通过。
证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-public-channel-join`。

## 解锁后手工复核

正式 Human 页面经真实指针点击检查，实际选中项只有一个。上一批截图另一处粉色是
Agent 行 hover，未复现为双重选中缺陷；已在原审计追加纠正，不改导航逻辑。

## 仍待施工

- 后端：公开正文读取统一资格、历史事件中非消息敏感字段的投影裁决，以及 Search/旧消息定位/附件等入口的权限撤销一致性。
- 前端：公开目录和非成员 Chat/Thread、加入成功后的刷新及输入区状态；不得先启用无业务结果的按钮。
- 关注：退出后继续关注公开 Thread 的资格与权限撤销语义。
- 验证：完整公开频道非成员场景的真实浏览器和同条件 Raft 双边验收；本批没有真实 CLI 验收或独立 Agent 审计。

## 本批交付记录

- `npm run check` 通过：packages 909 通过、2 个 opt-in 跳过，Web unit 351、parity regression 34、formal browser policy 9；这些数字属于各自测试集，不是产品完成率。
- 加入及 typed facade/Core 专项 16 项通过。协议错误 schema 原样提取为独立模块，Core 能力清单增加两个命名入口；没有放宽体积门禁。
- `npm run format:check`、`git diff --check`、正式 Web build 通过。浏览器回执 `rah-room-lifecycle-UuaOAs` 的 999 个输入 SHA 与当前代码一致，Chrome/Firefox 的 16 个退出/删除/迟到回执场景通过，已查看桌面/移动截图。
- 正式 build：`79658b879eff14a79ed01bfe88902d9a52ac1d6acce3aacc074b02cf4515318a`。
- 原正式实例 49308 通过 idle、身份及数据库检查，完整备份到 `/Users/sun/.rah/backups/pre-restart-6673dbe3-7c30-4aa1-b8eb-7fb518058fcd` 后正常退出；新实例 66197 使用冻结资产服务 `http://127.0.0.1:4173`。
- 重启后正式 discovery `rah-discovery-formal-7QMweQ`：Chrome/Firefox、桌面/390px，共 8 张截图；Settings/Human `rah-settings-formal-O0dtty`：48 张 Settings 与 4 张 Human 截图。均通过受约束请求守卫，无页面错误或未声明请求；已查看新的 Human 桌面/手机截图。
- `persistent-before.json` 与 `persistent-after.json` 内容完全一致：6 Room、43 Message、2 Task、378 event、4 Agent/35 定义修订、4 runtime profile/31 修订及 37 个私有记忆文件。正常只读检查可推进阅读前沿，不代表业务内容变更。
- 解锁后的前台手动复核先前已完成；后续 Mac 再次锁屏，重启后的证据为真实浏览器自动操作与截图查看，不宣称重启后前台 CUA 通过。
- 未提交、推送、运行付费 Provider，未调用旧工作 Agent。
