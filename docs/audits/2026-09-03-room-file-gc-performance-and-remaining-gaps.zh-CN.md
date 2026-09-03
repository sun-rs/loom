# Room 文件 GC 性能与剩余前后端缺口审计

日期：2026-09-03

状态：实现、隔离压力测试、正式 schema 42 重启、Firefox/Chromium 实页复核完成；全量门禁结果见本文。

## 1. 审计结论

schema 41 的功能/崩溃恢复审计成立，但最初没有覆盖极端大 backlog 的 CPU 与事件循环
压力，不能据此宣称长期运行性能已经充分验证。本次补做 0、1,000、10,000、100,000 条
回执基准后，确实发现全局 claim 的 nullable scope 条件和索引顺序会在 100,000 条同时到期
时把一轮 50 次 sweep 放大到约 4.2–4.6 秒、占满一个 CPU 核心。

schema 42 已把全局/单删除 claim 拆成精确 SQL，建立相应 due 索引和 failure partial index，
并加入 `EXPLAIN QUERY PLAN` 棘轮。相同 100,000 条 due backlog 的单轮现在约 14–16ms。
因此不能说“最初上线版本已经通过压力审计”；可以说本次审计发现并关闭了一个会造成
明显卡顿的真实性能缺陷。

## 2. 方法

- 使用隔离临时 SQLite、隔离 blob 根和直接 `RoomFileGcService`，不读取或改写正式用户数据；
- 每轮固定 50 次尝试，保持生产 60 秒 cadence 和 Multica 上游吞吐合同；
- 分别测 future/not-due idle sweep、全部 due sweep、真实 UUID blob + `.part` unlink；
- 记录 wall time、进程 CPU、RSS/heap 差值和数据库文件大小；
- 在 schema 42 初始化后再测，确保迁移和正式索引均进入被测路径；
- RSS 是进程分配器/页缓存下的近似增量，不把它冒充精确 retained heap。

## 3. 修复前后数据

| 场景                                   |                          schema 41 |                          schema 42 | 裁决                     |
| -------------------------------------- | ---------------------------------: | ---------------------------------: | ------------------------ |
| 空表 idle p95                          |                         约 0.061ms |                         约 0.050ms | 可忽略                   |
| 1,000 future idle p95                  |                             未单列 |                         约 0.036ms | 不随 future backlog 扫表 |
| 10,000 future idle p95                 |                             未单列 |                         约 0.034ms | 不随 future backlog 扫表 |
| 100,000 future idle p95                |                          约 3.65ms |                         约 0.035ms | 约 100 倍改善            |
| 1,000 due，50 次/轮                    |        p50 约 9.4ms，p95 约 14.9ms |      p50 约 4.94ms，p95 约 16.02ms | 小规模同量级             |
| 10,000 due，50 次/轮                   |     p50 约 137.4ms，p95 约 157.3ms |       p50 约 6.13ms，p95 约 7.35ms | 关闭可见卡顿             |
| 100,000 due，50 次/轮                  | p50 约 4,199ms，p95/max 约 4,613ms | p50 约 14.21ms，p95/max 约 16.05ms | 约 260–325 倍改善        |
| 50 blob + 50 `.part`，共 409,600 bytes |                           约 8.9ms |                          约 10.0ms | 文件系统不是原瓶颈       |

100,000 条 schema 42 due 回执连续 20 轮（共处理 1,000 条）的进程 CPU 约 238ms；该阶段
观测到 heap 无增长、RSS 约增加 0.5MiB，证明实现没有把 backlog 物化进 JS 内存。100,000
条活动回执数据库约 56.9MB，即约 569 bytes/条（含三个 GC 索引）；schema 41 基准约
37.5MB。额外约 19.4MB 是有意的索引成本，用来消除秒级同步扫描。

## 4. 是否会让 RAH OS 变卡

- 正常空 backlog 或大量尚未到期回执：不会形成有意义的 CPU 压力，隔离 p95 约
  0.03–0.05ms/分钟。
- 极端 100,000 条同时到期：一轮约 14–16ms，只在 60 秒 cadence 到来时发生；它可能占用
  一个 60Hz frame 的时间预算，但已不再是秒级冻结，且真实正常规模远小于该压力值。
- 内存：claim 一次只取一行，不把队列读入数组；100,000 条压力阶段 RSS 近似增量 0.5MiB。
- 磁盘：活动回执和索引会占空间；每个文件完成 15m/1h/6h/24h tombstone 观察后，其明细
  压缩进父回执，热表不会随历史文件总数无限增长。
- 吞吐：固定 50 次/分钟意味着 100,000 条极端 backlog 单靠周期 worker 约需 33 小时 20 分
  排空；Room 删除请求还会立即执行一轮。这是为保护前台事件循环采用的有界背压，不是
  UI 同步卡死。若未来要缩短排空时间，应采用显式 yield 的自适应多批，而不是取消上限。

## 5. 正式环境证据与整机压力边界

- active work 为零后完成一致性离线备份
  `/Users/sun/.rah/backups/pre-p16-gc-performance-20260903-NTzXBg`；三份 SQLite
  `quick_check=ok`，Room DB `foreign_key_check` 为空；旧备份按保留三份策略移入废纸篓，
  可恢复；
- 正式 daemon 已优雅停止并由标准命令重启，`127.0.0.1:4173` 单监听，Room schema 为
  42，三组 GC 索引存在，GC pending/due/failure 均为零；既有 submitted Task identity
  `task_4253d826-9ffd-45f7-970b-d5619636231b` 保留；
- Chromium 实页刷新后恢复 Room、1–10 报数、Task、Thread 与 Artifact；页面正文和 console
  均无 `JSON.parse`、`NetworkError`、重复逐消息错误；
- Firefox 正式实例显示通知权限 `granted`、本机订阅存在、登记设备数 1，测试推送请求完成；
  Settings、Room、Thread 和长消息投影可读；
- 定向 GC/daemon/migration 测试 16/16；全 package 828 项中 826 通过、2 项真实付费
  Provider 按规则跳过；Web 229/229、parity 34/34；typecheck、format、source checks、Web
  production build、`npm audit --omit=dev` 与 `git diff --check` 通过；本次仅追加审计证据后又
  单独复跑 format 与 `git diff --check`，均通过。

整机采样同时发现一条**与文件 GC 无关**的长期性能风险。正式进程在 GC 队列为空时连续
70 秒的主进程平均 CPU 约 10.06%、峰值 87.4%，RSS 为 544,048–544,896KiB；期间观察到
4 个模型目录探测子进程样本，单子进程峰值约 499,248KiB、45.7% CPU。代码追踪确认
`RuntimeOfferPublisher` 每 30 秒续租时调用完整 `probeRevision`，Host-local 目录缓存 60 秒
失效后会拉起 Claude/Kimi 等 CLI。它不会把子进程常驻，但会造成周期 CPU/内存峰值；因此
**不能把本次 GC 结论扩大为“整个 RAH OS 已证明长期绝不卡顿”**。

同一路径还存在确定的磁盘放大。`recordProbeReport` 每次都生成新的 UUID 和 `observedAt`，
二者又进入 `probeDigest`；即使模型目录没有变化，仍会插入一份不可更新、不可删除的完整
模型目录 JSON 和一条 audit。正式 `runtime-registry.db` 在审计时为 399,978,496 bytes，包含
33,235 份 probe report；其中 report 主表约 358.34MiB。最近 24 小时写入 12,075 份报告，
仅 JSON 正文约 121.0MiB。现场 35 秒复测仍新增 5 行和 57,344 bytes，证明它是当前持续
增长，不是一次性历史遗留。OpenCode 单份目录平均约 27.2KiB，是最大贡献者。这使该问题
同时成为 CPU、瞬时内存和无界磁盘增长的 P0，必须在下一批把 lease heartbeat、可执行文件
可信性检查、昂贵模型目录发现及历史审计分别建模，并为等价报告建立去重/快照加变更审计
和有界保留迁移；不能直接删除现有 append-only 证据表来掩盖增长。

Raft Computer 公开发布物主要使用静态 `RUNTIME_MODELS`，没有可直接复制的动态目录续租
实现；Multica 的本机模型目录缓存为 60 秒、effort 发现缓存为 10 分钟，Server 目录采用
按需 stale-while-revalidate 与 24 小时 last-known-good。下一批应结构化复用其“按需刷新、
短期 freshness 与长期 last-known-good 分离”的合同，把廉价 RuntimeOffer lease renewal 与
昂贵 CLI catalog discovery 解耦；仍需每次续租校验 active revision 和 executable identity，
不能为降载延长不可信可执行文件的生命。

后续状态（2026-09-03）：该 P0 已由 schema 43 / Runtime Registry schema 4 关闭。正式迁移后
两库合计缩小 96.04%，180 秒 heartbeat 无 Provider child、report 或 observation 增长，真实启动
仍复核冻结 executable SHA-256。详见
[RuntimeOffer 长期运行验证审计](./2026-09-03-runtime-offer-catalog-retention-verification.zh-CN.md)。

## 6. 剩余前后端缺口（按当前代码与正式实页重算）

| 优先级 | 缺口                        | 前端                                                                                          | 后端/运行时                                                                | 当前裁决                                              |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| P1     | daemon 长 soak 证据         | 无直接功能缺失                                                                                | heap/physical owner 已分解，空闲 fallback 已事件化；仍缺 1h/24h 斜率门禁   | 短时 CPU/footprint 已收敛，长期证据继续积累           |
| P1     | 设备通知最终真机证据        | macOS banner/click、Chrome 新订阅、iOS/PWA 后台/锁屏尚无完整证据矩阵                          | typed Room/DM/mention/Task/InputRequest/Review、mute/self suppression 已有 | 软件链完成，不把 Firefox 单例冒充全设备完成           |
| P1     | Agent Apps / External Agent | Apps tab 仍是明确空态；External 激活入口禁用                                                  | 缺 OAuth client/grant owner、可撤销外部设备凭据与 purpose fence            | 本地 CLI Agent 主链不受阻，Raft 功能仍不齐            |
| P1     | InputRequest 扩展生命周期   | 无结构化表单、可选 dismiss/TTL 产品状态                                                       | request/answer/cancel 与 Task cancel 原子闭环已有；自动 expire 无成熟来源  | 保持设计闸，真实需求再开                              |
| P1     | 消息高级动作                | 翻译、多选转发、部分 stale-safe Task 状态菜单未实现                                           | 缺相应 canonical command/read model                                        | 基础 reply/reaction/bookmark/thread/task 已完成       |
| P1     | 文件/Artifact 深度          | 部分格式仍只有下载/文本预览；Finder reveal、Range/大媒体、Git diff/build log 专用 viewer 未齐 | Room/DM/Thread/Task/Agent artifact 与本机项目安全浏览主链已有              | 不影响基本文件闭环，仍是 Raft/工作台深度差距          |
| P2     | 自定义头像孤儿回收          | 无影响                                                                                        | 内容寻址头像写入已完成，旧无引用 profile blob 尚无安全 GC                  | 会形成缓慢磁盘泄漏，复用本批 receipt/引用复查框架另做 |
| P2     | 前端首包                    | 首次加载 production 主 chunk 仍超过 Vite 500KiB 警戒线                                        | 无                                                                         | 需要路由/面板级继续懒加载并做冷启动测量               |
| 证据   | Raft 同前置双边覆盖         | Agent 非空 Workspace、部分 Search/长历史/设备通知仍缺同前置官方在线证据                       | 本地实现已有自动化与正式实页证据                                           | 属于证据缺口，不倒算成功能未实现                      |

后续已关闭：Web bundle 跨版本自愈现在具有内容确定 build ID、gateway response fence、一次性刷新/继续提示和
typed deep link 保留；旧 schema/JSON 错误不会再复制到每条 Message。正式双 generation 切换与 desktop/390×844
真实 Chrome 证据见 [Web build recovery 验证审计](./2026-09-03-web-build-recovery-verification.zh-CN.md)。daemon
空闲高频扫库也已由 content-free Outbox wake + 30 秒 fallback 取代，见
[本地 Runtime 留存与空闲调度审计](./2026-09-03-local-runtime-retention-and-idle-audit.zh-CN.md)。

已关闭、不得再按旧报告重复计为缺口：Room archive/leave/permanent-delete/SOS、成员角色、
全局 Tasks/Search/Activity、sidebar 排序/拖拽/注意力点、Agent 模型/effort/资料/动态/Memory/
restart/session/full reset、本机 Computer 资料、基础 Human Inbox/InputRequest、typed deep link、
reply/reaction/bookmark/Thread、Room/DM/Thread/Task/Agent Files 主链，以及 RuntimeOffer 续租与
目录探测/留存解耦。

产品明确排除：Raft 中央账号、套餐/账单、中央应用商店、公开分享 URL、社区邀请；用户已
要求暂不考虑多 Computer 与跨机文件传输，这些不计当前待开发缺口。
