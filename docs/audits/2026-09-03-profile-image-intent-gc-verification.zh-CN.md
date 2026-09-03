# Profile Image 上传意图与 GC 验证审计

日期：2026-09-03

## 结论

头像存储的“先上传 blob、后保存资料”崩溃窗口已经关闭。RAH OS 现在先在 Kernel 记录
actor-bound `uploadIntentId`，再发布内容寻址文件；Human、Workspace、Agent 资料保存必须在
同一 SQLite 事务中消费匹配意图。未绑定图片和替换后失去全部引用的图片由独立、有界、可恢复
的 daemon reconciler 回收。

这不是对 Raft Server 实现的臆测：Raft 证据只用于上传/绑定的一次产品操作、5 MiB 和资料回读
合同；物理回收采用 Multica 成熟的 claim/lease/backoff/tombstone 不变量，再适配 RAH OS 的
单机 SQLite 与本地文件。没有引入 PostgreSQL、对象存储、中央服务器或第二套头像真相。

## 来源与复用裁决

| 层       | 固定来源                                                                                                                       | 采用内容                                                                                                        | 本地差异                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Raft Web | `AgentDetailPanel-DKwoNvgK.js`，SHA-256 `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`，符号 `Me`          | 5 MiB 校验、一次上传操作、以响应 Agent 更新投影                                                                 | 通用上传端点返回 receipt，下一次 typed profile 保存消费它                        |
| Multica  | revision `11861145abc59a0d39c8c8f24ad837d4584e664f`；`channel_media_reconciler.go`、`channel.sql`、`source_context_sweeper.go` | pending→deleting fence、claim 后引用复核、2m lease、50/轮、1m..1h backoff、15m/1h/6h/24h tombstone、60s cadence | SQLite `BEGIN IMMEDIATE`、本机 `unlink`；仅结构化移植，不复制 Go/PostgreSQL 实现 |

## 实现审计

```text
Web upload
  -> ProfileImageStore 在发布前调用 Kernel.recordUpload(actor, key)
  -> 返回 avatarKey + uploadIntentId
  -> profile mutation 在同一事务 bindReference + 写 canonical profile + release old key
  -> daemon startup inventory + 60s ProfileImageGcReconciler
  -> Kernel claim（settle/lease/batch）
  -> store.reclaim(exact content hash)
  -> token-fenced complete/retry/tombstone
```

- schema 45 新增 `profile_image_objects`、`profile_image_upload_intents` 及 due/key 索引。
- 同一内容的多次上传由独立 receipt 区分；receipt 必须属于当前 Human 且 key 完全匹配。
- 已有 canonical 引用的 key 可幂等复用；新 key 不允许绕过 receipt。
- 完整引用查询覆盖 Human、Workspace 与所有 Agent definition revision，而不是只看当前 revision。
- GC claim 后迟到 bind 失败；bind 已提交时二次引用复核保留文件。
- `unlink` 失败按 lease token 退避；进程崩溃后过期 lease 可接管；tombstone 重删覆盖迟到 rename。
- 启动 inventory 只登记严格内容哈希文件；老 `.part` 只在名称严格匹配且超过 settle window 后删除。
- daemon runner 不解释业务引用，Web/Provider 不扫描本地目录。

## Failure-first 与自动化证据

第一次定向运行在旧实现上稳定失败 5 项：上传无 receipt、store 无 reclaim、Kernel 无生命周期 owner；
实现后以下门禁通过：

- profile store/Kernel/reconciler/source-boundary 定向套件 12/12；
- schema、Agent profile update、HTTP/SDK/profile UI 契约通过；
- `npm run check`：850 个 package 测试中 848 通过、2 个真实付费 Provider 按规则跳过；245 个
  Web 单测、34 个 parity callback regression 全绿；
- `npm run build:web:workbench`：3033 modules transformed；
- 真实 Chrome 完整 Workbench gate：桌面与 `390×844`、Agent 图片选择/上传、标题与消息头像回读通过；
- Firefox 150.0.2 完整 Workbench gate：`1440×1000` 与 `390×844`、持久会话和真实上传路径通过。

## 10 万行压力审计

优化前 startup inventory 在循环内重复 prepare，100,000 行登记约 1,761 ms、RSS 增量约
538.3 MiB。该结果没有被当作可交付状态。把引用查询和 insert statement 提升为单次 prepare 后：

- 100,000 行登记约 1,159 ms；
- 一轮 50 项 GC 约 18.96 ms，恰好回收 50，保留 backlog 99,950；
- RSS 增量约 45.9 MiB，SQLite 文件约 31.4 MiB；
- query plan 命中 `idx_profile_image_objects_due`，intent 复核命中
  `idx_profile_image_upload_intents_key_age` covering index。

这证明单轮 CPU/IO 有界，也暴露并修复了一处真实的启动内存压力。它不是 24 小时 soak 的替代品；
长期运行证据仍按剩余优先级独立执行。

## 正式 4173 发布复核

切换前正式端口没有监听进程，因此没有中断一个活跃实例。只读审计确认 schema 44、三库
`quick_check=ok`，30 个 Activation 全部 `completed`、30 个 RunAttempt 全部 `exited`、30 个
RuntimeProcess 全部 `terminated`；没有 active Agent exclusive lease 或 held draft。30 条未发布
Outbox 是持久 content-free wake 工作，不是正在执行的 Provider 进程，启动后由原 owner 继续处理。

迁移前使用 SQLite online backup 创建
`/Users/sun/.rah/backups/formal-pre-profile-gc-nU820HQY`，包含 Room、Runtime Registry、Web Push
三库及 Computer profile；三份备份再次 `quick_check=ok`，总计约 46 MiB，没有复制 860 MiB 的整个
数据根。随后以通过门禁的冻结 Web 资产启动正式实例：

- `127.0.0.1:4173` 精确 PID `85464`，health `online`；
- Room schema 44→45，迁移后 `quick_check=ok`，执行终态计数保持 30/30/30；
- 首次 inventory 得到 0 个 profile blob/intent，与正式目录为空一致；
- 全新真实浏览器冷开默认 Room，历史、三项 Room tab、240px 侧栏和 composer 正常；0 个 broken image；
- 正式 Agent 资料页显示头像 picker、16 个官方 preset、`上传图片`、名称/描述/Runtime/模型/effort
  编辑入口；本次只读复核没有改用户资料；
- Settings 账户/通知可打开，页面和 console 都不存在 `JSON.parse`、`NetworkError`、
  `Failed to fetch`、`RAH Client request failed` 或 token 泄漏错误，console warn/error 为 0。

## 剩余边界

1. Raft Server 的头像物理 GC 源码未公开，因此不能宣称 byte-for-byte 后端复制；可证明的是产品合同
   与 Multica 状态机不变量。
2. Agent 历史 revision 被视为 durable 引用，故不会回收历史曾使用的头像；改变此策略需要独立
   retention 合同。
3. 本批关闭的是头像磁盘卫生与崩溃窗口，不等于完成设备通知的横幅/点击和 1h/24h soak，也不扩大
   Artifact viewer、InputRequest 或 External Agent 范围。
