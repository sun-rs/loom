# Profile Image 上传意图与引用安全 GC 合同

状态：已按 failure-first 完成施工与双浏览器隔离验收，正式实例发布证据见配套审计

日期：2026-09-03

## 1. 结论

RAH OS 已有 Human、Workspace 与 Agent 共用的 owner-private、内容寻址
`ProfileImageStore`，但浏览器当前执行的是“先上传 blob，再保存资料”两步。若第二步因
revision stale、权限变化、关页或崩溃失败，磁盘会留下没有 canonical 引用的 blob。

不能只按“当前没有引用”或一个经验保留期直接删除。正确方案必须先把上传和绑定之间的
竞态变成 durable 状态：

```text
准备并验证图片、算出 avatarKey
  -> Kernel 先记录 uploadIntentId + avatarKey
  -> ProfileImageStore 原子发布 immutable blob
  -> Human / Workspace / Agent 资料事务消费同一个 uploadIntentId
  -> canonical 引用成功，或未绑定意图进入有界 GC
```

GC 不是新的业务真相，也不改变头像产品交互；它只回收不能再被 canonical profile 绑定的
本机字节。

## 2. 上游依据

### 2.1 Raft 产品合同

- 冻结文件：`docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`
- SHA-256：`b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`
- 符号：`Me`

Raft Web 对 Agent 图片执行一次 `POST /agents/{id}/avatar` multipart，并以响应中的 Agent
替换目录投影；从浏览器观察，上传与资料更新是一个产品操作。发布 bundle 没有公开 Raft
Server 的存储事务或物理 GC，因此不能宣称复制其服务端实现。

RAH OS 保留已有通用图片上传端点，以便 Human、Workspace 和 Agent 共用同一存储；新增的
`uploadIntentId` 把两次 typed 请求组合成与 Raft 同等安全的一个逻辑操作。UI loading、错误、
Escape/focus 和 5 MiB 限制不改变。

### 2.2 Multica 可靠性结构

- 仓库：`https://github.com/multica-ai/multica.git`
- revision：`11861145abc59a0d39c8c8f24ad837d4584e664f`
- 来源：
  - `server/internal/service/channel_media_reconciler.go`
  - `server/pkg/db/queries/channel.sql`
  - `server/cmd/server/source_context_sweeper.go`

结构化采用：上传前 intent、bind 事务消费、pending→deleting 的 claim fence、claim 后引用复核、
2 分钟 lease、每轮 50 次、1 分钟到 1 小时退避、`15m / 1h / 6h / 24h` tombstone 重删、独立
60 秒 worker。Multica 的 PostgreSQL、对象存储、Workspace tenancy 和 Go 实现文本不复制；
RAH OS 使用单 daemon SQLite `BEGIN IMMEDIATE` 与本地 `unlink`。

Multica 源码带附加许可条件。本项目只移植上述状态机不变量，并在复用台账保留来源、版本和
归属，不引入其 UI 或直接拷贝实现文本。

## 3. RAH OS 必要适配

Raft/Multica 的对象 key 都不等同于 RAH OS 的全局内容哈希 key。相同图片可被多个主体或多个
并发上传复用，因此不能让 `avatarKey` 本身充当一次上传凭据：

- 每次上传生成独立 `uploadIntentId`；上传响应同时返回它与 `avatarKey`；
- 设置一个新的 uploaded key 时，资料命令必须提交该 intent；若 key 已有 canonical 引用，
  允许复用而不强迫重新上传；
- bind 在同一资料事务中只消费 actor 自己、key 完全匹配且仍为 pending 的 intent；GC claim
  后旧 intent 永远不能绑定；
- abandoned intent 超过 15 分钟才可 claim。claim 时先删除该 key 的过期 intent，再在事务外
  删除 blob；每次删除前重新检查 canonical 引用；
- 新上传遇到已 claim 的 key 必须失败并允许重试，不能复活正在删除的对象；已完成一轮删除且
  无 active lease 的 tombstone 可以被新上传安全重置为 pending；
- 进程崩溃遗留的旧 `.part` 只在超过 15 分钟且名称严格匹配 store 临时格式时回收；完整 legacy
  blob 在启动 inventory 后进入同一 ledger，不能另写一次性清理脚本。

## 4. 完整引用图

物理删除前，Kernel 必须检查：

1. `principals.avatar_key`；
2. `workspaces.avatar_key`；
3. 所有 `agent_definition_revisions.definition_json.avatarKey`，而不只当前 revision。

第三项是有意保守：Agent revision 是 canonical 审计记录，旧 revision 仍然算持久引用。因而本批
主要回收“上传后未保存”的 blob，以及 Human/Workspace 替换后且不再被其他主体引用的 blob；
不会为了提高回收率破坏历史 revision。任何缩小引用图的优化都需要独立的数据保留合同。

## 5. Single owner

```text
protocol
  上传回执 + 三类资料命令的 uploadIntentId
kernel ProfileImageLifecycle
  durable intent/object ledger、bind fence、引用图、claim/lease/backoff/tombstone
daemon ProfileImageStore
  sniff/hash、before-publish intent、atomic rename、exact unlink、stale .part inventory
daemon ProfileImageGcReconciler
  60 秒 cadence 与每轮 50 次上界，不解释业务引用
Web
  把上传回执原样交给现有资料命令；不持久化第二份 GC 状态
```

Kernel schema 使用新版本迁移。profile mutation 与 bind/release 必须共享现有 SQLite transaction；
ProfileImageStore 不读 Kernel 表，Web 不扫描磁盘，Provider runtime 不参与。

## 6. 失败与恢复

- intent 写失败：不得发布新 blob；
- intent 成功、文件写失败或请求中断：intent 保留，15 分钟后由 GC 回收可能存在的字节；
- 文件成功、资料写 stale/失败：UI 保留原头像和错误；intent 后续进入 GC；
- GC claim 后的迟到资料保存：因 intent 已被 fence 而失败，不会建立悬空引用；
- `unlink` 失败：lease-token guarded release，按指数退避；
- `unlink` 成功后进程崩溃：过期 lease 可接管；tombstone 重删覆盖迟到原子 rename；
- GC 发现 canonical 引用：保留 blob 并清理该对象的维护 ledger；
- store 中 legacy 完整 blob：启动时登记；已引用则保留，未引用按原 mtime 和 settle 规则处理；
- 符号链接、特殊文件、未知文件名：不删除并报告健康异常。

## 7. 验收

1. protocol、Kernel、store、HTTP/SDK 与三类 profile UI 先有失败测试；
2. 竞态门禁必须证明 claim 后 bind 失败、bind 提交后 GC 保留、并发相同内容的 intent 彼此隔离；
3. 重启门禁覆盖 stale lease、遗留 intent、legacy blob 和 `.part`；
4. 10 万 ledger 行记录查询计划、wall time、CPU/RSS 与数据库大小；单轮仍最多 50 次；
5. 真实 Chrome/Firefox 在 desktop 与 `390×844` 上传 Agent 图片、刷新恢复、切回官方头像，且
   stale save 不产生破图；
6. 全库、格式、diff、生产 build 与相关浏览器门禁通过后，检查正式 active work、在线备份、
   精确重启 4173，再只读验证既有头像与页面无错误。

证据必须区分 `C/A/L/R/D`。Raft Server GC 未公开，`R` 只覆盖前端可证明的单操作语义；后端
可靠性是 Multica 状态机的结构化移植与 RAH local-first glue。

## 8. 实施结果

- `C`：protocol 已把 `uploadIntentId` 纳入上传回执及 Human、Workspace、Agent 三类资料命令；
  Web 不持有 GC 状态，只把回执交给随后一次 revision-fenced 保存。
- `A`：Kernel `ProfileImageLifecycleService` 是唯一 durable owner。上传意图、资料绑定、旧引用释放、
  GC claim/lease/backoff/tombstone 均由 schema 45 的 SQLite 状态承担；bind 与资料 mutation 共用
  `BEGIN IMMEDIATE`。
- `L`：本机 `ProfileImageStore` 继续采用既有内容寻址、`.part`、原子 rename 与严格文件名规则；
  daemon 仅增加启动 inventory 和每 60 秒有界 reconcile，不引入对象存储或中央服务。
- `R`：Raft 的 5 MiB、一次头像操作、响应后更新 Agent 投影的产品行为保持；Multica 只提供
  pending/deleting claim fence、二次引用复核、lease、退避和 tombstone 的结构参考。
- `D`：Agent 历史 revision 中的头像引用有意保守保留；本轮主要回收上传后未保存、Human/Workspace
  替换后且无人引用的本地 blob，不把审计历史当垃圾。

定向测试、10 万行压力、Chrome/Firefox 桌面与 390×844，以及正式 4173 的重启结果记录在
`docs/audits/2026-09-03-profile-image-intent-gc-verification.zh-CN.md`。
