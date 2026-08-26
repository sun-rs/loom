# Runtime Placement 与下一阶段独立审计（2026-08-26）

状态：**R1/R1.1 三路初审与整改复审完成；R2b 经过七轮独立 adversarial 审计，第七轮无 P0/P1/P2 并正式 APPROVE。窄 R2b 已收口，允许进入下一阶段前置实现；这不等同于 MultiLaneAgentHost 已完成。**

## 1. 审计范围与方法

三名互不依赖的审计 Agent 分别从以下角度只读检查当前工作树、架构文档、实现和免费测试：

1. 对照 ADR-0009、Runtime Registry 架构和路线图，检查 owner、不变量与实现差距；
2. 对照 Raft、Multica、ACP Registry、Patchwork/Kandev 与 Nomad 的公开机制，检查下一阶段是否可操作；
3. 以 adversarial/fault-injection 方式复现 terminal proof、crash window、Host generation、Offer 时序和并发 reserve。

审计时仓库没有可引用的 Git HEAD，全部文件仍是 untracked；因此本文只能绑定 2026-08-26 的本机工作树，不能伪装成 commit-level 证明。建立 baseline commit 有利于后续审计，但本轮未在没有用户明确授权时自动提交。

## 2. 独立结论

三路 verdict 分别为“未收口”“先做 R1.1、不要直接进入完整 R2”和“REJECT 当前 R1 安全声明”。它们同时认可：

- Room-first business truth、Agent/runtime/model 解耦、pure planner 与 immutable winner provenance 的方向成立；
- SQLite `BEGIN IMMEDIATE` 下的跨连接单次 reserve 成立，额外双进程 barrier 复现也只产生一个 winner；
- 当前阻断点集中在 terminal proof、crash recovery、Host generation 和“Host 自报证据被当成安全授权”，而不是 transcript parser；
- 不能由一个 Host 可写的 `certified` 字符串、可变 Offer head 或缩减后的 candidate digest 证明历史调度依据。

因此正确顺序是：

```text
R1 运行安全修复
  -> R1.1 trusted evidence + immutable offer observation
  -> R2a immutable Host-local registry
  -> R2b driver/probe/secret late binding
  -> R3 MultiLaneAgentHost
```

## 3. 审计后已关闭的缺陷

以下项目均先增加确定性失败测试，再修改实现：

| 缺陷                                                          | 审计时风险                                                              | 当前处理                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finishRunAttempt` 可在 RuntimeProcess 非终态时释放 Placement | 未证明退出的旧进程与新进程可能同时占用 workspace/capacity               | 存在 RuntimeProcess 时必须已有 terminal proof；否则抛出 `RuntimeTerminationProofError`。unproven cancel 改为直接 orphan/quarantine，不经过 finish   |
| create RunAttempt 后、prepare 前崩溃                          | 无 RuntimeProcess 可恢复，却会永久 quarantine 并泄漏资源                | lease expiry 将旧 RunAttempt 标为 failed，释放 Placement/capacity/workspace，合并 follow-up 后重新排队                                              |
| finish RunAttempt 后、retry/complete 前崩溃                   | Activation 永久停在 expired `leased`                                    | 无 active RunAttempt 的 expired lease 统一恢复并重新排队，保持 at-least-once business execution                                                     |
| 新 Host generation 接管旧 Placement                           | 同 Host ID 的新 daemon 可 prepare/finish 旧 generation 的 Run           | Placement-backed prepare/start/finish/termination/Worker grant/renew/retry/quarantine/complete 均校验 `host_instance_id`                            |
| 延迟旧 Offer 覆盖新状态                                       | 旧 `available` 可覆盖较新 `unavailable` 并被调度                        | observation 必须单调；同时间戳只允许完全相同的幂等 replay                                                                                           |
| Host 时间与 lease 无边界                                      | future clock/超长 TTL，Placement 可活得比 Offer 久                      | future skew 上限 5 秒；Kernel 将 Offer TTL clamp 为 5 分钟；Placement lease 不超过 Offer 剩余 TTL                                                   |
| retry 绕过 terminal proof 或泄漏 reservation                  | active runtime 可被重新排队；pre-run reservation 等待过期               | active RunAttempt 时 retry fail closed；没有 RunAttempt 的 retry 原子释放 Placement 资源                                                            |
| 旧库 terminal RunAttempt 仍关联 nonterminal RuntimeProcess    | retry/lease recovery 会释放旧 Placement 并创建第二次执行                | retry 按 Activation 检查任何 nonterminal process；lease expiry 以 process evidence 为准进入 quarantine/orphan；资源释放中心函数再做统一 proof guard |
| 旧库已错误 retry 并删除 Placement reservation                 | queued Activation 可再次 Placement；共享 Host/Pool/Workspace 也可能碰撞 | startup/schedule/legacy lease 做全状态 reconciliation；planner 从 nonterminal process 反向重建 participant 与隐式资源占用，直到 terminal proof      |
| terminal proof 后、Run finish/quarantine resolve 前崩溃       | 已无 recovery target，却会永久停在 orphaned/quarantined                 | expired live Run 按 terminal record 自动结算；全部 RuntimeProcess terminal 的 quarantine 由 startup/schedule/legacy lease 幂等解除并重排            |
| v3→v4 migration 缺 Placement FK                               | migrated schema 与 fresh schema 不等价                                  | `placement_id` migration 保留 `REFERENCES placements`，测试直接核对 `foreign_key_list`                                                              |

这些修复只证明本轮列出的运行安全路径，不等于 R1 的信任模型已经完成。

## 4. 尚未关闭的硬门禁

### 4.1 初审时的 R1.1 缺口：可信证据与不可变 Offer observation

以下保留初审时的事实快照；对应整改见第 7 节：

- Host 当前仍可在 `RuntimeOffer` 中自行填写 `probed/certified`，Kernel 尚无 admin/repository-owned certification catalog；
- `runtime_offers` 仍是可变 head projection，没有 immutable observation row、server-owned `acceptedAt`、snapshot digest 与 evidence refs；
- Placement 尚未冻结 `runtimeOfferObservationId`、offer snapshot digest、probe digest 与 certification digest；
- `candidateSetDigest` 只覆盖缩减后的 decision evidence，不能宣称是完整调度 snapshot digest；
- Host 自报 `capacityPoolIds` 仍不能作为共享账号额度的管理授权。

最小实现不需要 PKI。应先建立 Kernel-owned 内建 certification catalog、不可变 observation 表和严格引用；Host report 只能提供 observation，不能自行提升信任等级。认证撤销只阻止未来 Placement，不改写历史 Placement。

### 4.2 R2a/R2b：Host-local registry

R2a 只实现 owner-private registry、canonical manifest、不可变 revision、显式 activate/deprecate 和 append-only local audit。相同 normalized manifest 必须得到同一 digest；语义变化必须创建新 revision；import 不得隐式 activate。

R2b 再加入严格且版本化的 adapter/recovery driver registry、绑定 profile digest/driver/executable identity/version 的 immutable probe report，以及 spawn 前 secret-slot late binding。secret value 不进入 manifest、digest、offer、probe、diagnostics 或错误文本。

### 4.3 进入 Multi-Lane 前

- placement-managed Agent 必须禁止裸 `leaseNextActivation` compatibility path；
- `pullNextPlacement` 需要原子 claim/launch authority，不能让同 generation 多个 LaneRunner 同时得到同一 reserved Placement；
- CapacityPool membership 与 admin cap 必须由 Kernel control object 拥有；
- durable PlacementHold、Agent disable/tombstone mutation 和 model fallback 仍是 design-only；
- recovery lease 的 Host instance generation、完整 migration equivalence 与真实并发 barrier 应继续补齐。

## 5. 相对公开项目的可证优势与边界

- Raft 已证明 runtime 可替换而 Agent identity/workspace/memory 保持；RAH 的可验证差异应是 Room/Task business truth、不可变 revision/Placement evidence 和不依赖 provider transcript 的完成门禁，而不是 UI 形态。[Raft Runtime](https://docs.raft.build/features/agents/runtime/)、[Agent lifecycle](https://docs.raft.build/features/agents/lifecycle/)
- Multica 已证明一个 daemon 可以承载多 runtime/profile 和任务编排；RAH 采用 Agent/runtime/model 解耦，但把 secret 留在 Host、把 Task complete 与 process exit 分离，不把 server plaintext env 或 rich output parser 作为核心。[Multica daemon/runtime](https://multica.ai/docs/daemon-runtimes)、[Agent credentials](https://multica.ai/docs/agents-create)
- ACP/Patchwork/Kandev 说明标准 runtime protocol 可降低逐 CLI 适配量；ACP capability negotiation 只能形成 probe observation，不能自动成为安全 certification，也不能拥有 Room/Task。[ACP v2](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx)、[ACP Registry](https://github.com/agentclientprotocol/registry)、[Patchwork](https://github.com/vincelwt/patchwork)、[Kandev](https://github.com/kdlbs/kandev)
- Nomad 的版本化 driver、strict config、fingerprint、allowlist 和独立 secret provider 值得用于 R2；不应复制完整集群调度器或通用 policy DSL。[Nomad Task Driver](https://developer.hashicorp.com/nomad/plugins/author/task-driver)

当前可以声称的优势是“业务状态不依赖 JSONL/CLI session，且已有可复现的 Room/Task/terminal-proof 本机门禁”。在 trusted evidence、registry、multi-lane 和竞争基准完成前，不能声称已经全面优于 Raft/Multica 或已经具备生产级多 Agent workstation。

## 6. 初审时的下一开发决策

下一步固定为 R1.1，而不是直接改 daemon config v3：

1. 设计并测试 `RuntimeOfferReport -> trusted immutable RuntimeOfferObservation`；
2. 加入最小 certification/probe reference 和 server-owned evidence promotion；
3. 扩展 Placement provenance 与 candidate snapshot digest；
4. 再实现 R2a manifest/registry，最后才让真实 daemon 从 registry 发布 offer。

整个过程继续禁止 Provider transcript/JSONL 进入 Room truth，也不运行付费 CLI gate，除非用户另行明确授权。

## 7. 整改结果与最终复审

初审之后又进行了两轮 adversarial 复核，并以红→绿测试关闭了新增发现：

- schema 升至 v5；每次 accepted Offer 写 append-only `runtime_offer_observations`，head 只作 current projection；
- snapshot digest 使用 `rah/runtime-offer-snapshot/v1` domain，Placement 顶层及每个 candidate evidence 都冻结 observation ID/digest；
- startup-owned `RuntimeCertification` 使用 `rah/runtime-certification/v1` canonical digest，capability 顺序规范化；digest 不匹配或同 ID 不同完整内容均拒绝；
- projection 同时保存 Kernel 当时解析出的 redacted certification subjects，catalog 后续移除不影响历史解释，但阻止未来 Placement；
- Host 自报 `certified` capability/isolation 必须匹配 certification subject；Host 自报 certified model binding 直接拒绝；`probed` 明确保留到 R2b 的 immutable ProbeReport；
- direct Runtime termination 和 orphan recovery lease 都绑定具体 Host instance generation；replacement generation 不能继承旧 execution/recovery authority；
- 真实 buggy-v4（已有无 FK `placement_id`）通过 transactional table rebuild 修复；旧 mutable Offer head 升级后 fail closed，必须 republish 才产生 v5 observation；
- 全部新 Placement 的 observation provenance 非空；legacy migrated Placement 允许缺失，但不能伪造历史 observation。
- 最终 adversarial 复核先构造出旧版本遗留的 `RunAttempt(failed) + RuntimeProcess(active)`，又把 crash point 推进到旧 Kernel 已错误写成 `Activation(queued) + Placement(released)` 并删除 capacity/workspace reservation 的完整状态。Kernel 现在以 nonterminal RuntimeProcess 作为更强事实：retry fail closed；startup、schedule 和 legacy lease 都会全状态 reconciliation；失去 live lease 的执行转为 quarantine/orphan；planner 从 nonterminal process 反向重建 participant、Host、Offer、Profile、Pool 和 in-place Workspace 隐式占用；所有未来 Placement 资源释放还经过统一 terminal-proof backstop。旧 reservation 即使已被删除，也不能产生第二个 Placement。
- 审计继续推进到 terminal proof 已提交、但 `finishRunAttempt` 或 `resolveActivationQuarantine` 尚未提交的两个 crash window。expired live Run 现在根据已持久 terminal record 自动结算为 exited/failed 并重排；全部 RuntimeProcess 已 terminal 的 quarantine 则由 startup/schedule/legacy lease 幂等解除。无人值守恢复不再依赖一个已经不存在的 recovery target 或人工 resolve。

三名审计者最终均允许下一步进入 **R2a 的窄范围**：strict `RuntimeProfileManifestV1`、versioned canonical digest、owner-private immutable revision registry、显式 activate/deprecate 与 append-only local audit。这个 verdict 不授权 R2b probe/secret、daemon config v3、multi-lane、admin CapacityPool 或真实付费 CLI gate。

## 8. 审计门禁后的 R2a 推进（历史快照）

审计允许的窄 R2a 已在同一 baseline 后按红→绿测试实现：Host-bound owner-private registry schema v1、strict `RuntimeProfileManifestV1`、`rah/runtime-profile-manifest/v1` canonical digest、idempotent object/file import、immutable semantic revision、显式 activate/deprecate 与 database-enforced append-only local audit。manifest 文件修改创建新 revision，不改写旧行，也不自动激活；registry/manifest path 不进入 revision 或 audit。

本实现没有扩大审计授权：v1 只支持内建 `generic-process/v1` 的无 secret 描述；R2b probe/secret/adapter registry、daemon config v3、Offer publication、MultiLaneAgentHost 与真实 CLI gate 仍未实现。

## 9. R2b 第一、二轮独立审计

R2a 后实现了 registry schema v2、strict manifest v2、immutable ProbeReport、versioned adapter/recovery map、spawn-time credential slot、daemon config v3 与 redacted Offer publisher。独立审计没有直接接受实现完成声明：

- 第一轮 REJECT 发现 `staticEnv` 可持久化 API key、caller-mutated revision 可绕过 probe digest、spawn 不重验 executable、Offer 无限续租旧 probe、diagnostics 先截断后脱敏、recovery 未冻结旧 revision/driver version、prototype slot 绕过、未来 R5 重复使用 config v3，以及伪造的 v1 migration fixture；
- 整改加入常见 credential-bearing static-env 拒绝、revision digest 重算、spawn preflight、live reprobe、单 secret 截断前脱敏、recovery provenance/old-revision resolver、own-property slot、未来 config v4 和真实 v1 DDL/trigger fixture；
- 第二轮仍 REJECT：它确定性复现了 preflight check→supervisor launch 间替换 executable、重复长 secret 在截断缩短后泄漏下一份前缀，以及 active revision 切换后冻结 daemon 继续启动 future work；另发现 Worker bearer 未加入 redaction set和 secret file stat→read 无界增长竞态。

第二轮整改把 expected executable identity 传入 supervisor 并在 target spawn 前重验；diagnostics 改为流式、有界、多模式 redactor；AgentHost probe/start 与 Offer refresh 重读 active pointer/state/digest；v2/v3 Worker bearer 加入 redaction set；FileSecretProvider 从已打开 fd 最多读取 65,537 bytes。文档同时明确：同一 OS 用户下最终 check→exec 仍有极窄平台竞态，config v2 legacy recovery descriptor 不含 profile provenance，伪装成普通 static env 的 secret 不在自动分类保证内。

## 10. R2b 第三轮独立审计与继续整改

第三轮确认 executable credential-load 竞态、HMAC terminal proof、重复长 secret、Worker bearer、bounded file read、lifecycle start fence 与旧 revision recovery 已关闭，但仍给出 REJECT：流式 matcher 会让较短 complete secret 抢先于同位置或更早位置的较长 partial secret。审计复现 `['abcdef','abc']` 在 `abc -> def` 分块后输出 `[REDACTED]def`，以及 `['abcdef','bc']` 在 `a -> bc -> def` 后输出 `a[REDACTED]def`。

第三轮后的 matcher 曾改用 leftmost-longest 延迟决策：若更早或同位置仍存在可跨 chunk 完成的长 secret 前缀，就只提交其前方安全文本并保留未决后缀，不接受短匹配。新增门禁覆盖长短前缀重叠、非零 offset、重复长 secret + byte truncation、UTF-8 code point 内分块和 EOF partial suffix。第三轮同时指出 profile pointer 可在 `probe()` 与 `createRunAttempt()` 之间变化；这最多留下一个显式 failed pre-launch RunAttempt，start fence 仍保证不读取 credential、不 prepare/spawn。文档已收窄为这一真实并发边界，不宣称原子阻止 RunAttempt 创建。

## 11. R2b 第四轮独立审计与区间式 redactor 整改

第四轮确认第三轮指定的同起点和长 secret 更早起点 fixtures 已关闭，但继续给出 REJECT：`['abc', 'bcdef']` 对 `abcdef` 会让先选中的短匹配吞掉后一长匹配的起点，输出 `[REDACTED]def`；`['abcdef', 'abc']` 对 EOF `abcd` 会输出 `[REDACTED]d`。这证明 leftmost-longest 仍不足以表达反向、偏移与链式重叠。

整改不再逐个贪心选择 secret，而是在当前有界窗口内找出全部完整匹配，按“有字符相交”合并区间；跨安全提交边界的区间以已脱敏前缀状态延续，因而链式重叠也不需要无界保留历史。非 final drain 保留 `maxSecretLength-1` 个 UTF-16 code units；final drain 把最长 EOF partial suffix 作为待脱敏区间并入同一组件。相邻但不相交的重复 secret 保持各自的 `[REDACTED]`，相交或链式相交的 secret 只产生一个连续脱敏组件。新增失败优先门禁覆盖 `abc -> def -> ghi` 上的 `['abc', 'bcdef', 'efghi']` 链，以及 EOF `abcd` 上的 `['abcdef', 'abc']` overlap。本轮整改完成后仍需第五轮独立复审，本文不提前宣称 APPROVE。

## 12. R2b 第五轮独立审计与资源有界化整改

第五轮 adversarial confidentiality matrix 共 17 组全部通过，但仍给出 REJECT。审计以 32 个合法重叠 patterns（`a` 到 `a × 32`）、32 KiB stdout 和 64-byte diagnostic limit 复现：上一版先物化每个 pattern 的每个 occurrence 再排序，最大 RSS 比基线增加约 119 MB；协议最多允许 64 个 credential slots，因此这是 daemon availability P1，而非单纯性能优化。它同时发现 safe boundary 可能切开与 secret 无关的 UTF-16 surrogate pair，把 `A🔐BBBB` 损坏为 `A��BBBB`。

整改保留相同的区间语义，但 occurrence 只写入窗口等长的 start/end `Uint32Array` 事件计数，再线性扫描生成相交组件；临时空间为 `O(window + components + patterns)`，不再是 `O(chunk × redactionCount)` 个对象。decoder 输出按最多 65,536 code units 分段，实际扫描段下限为 1,024、上限为 65,536，并在 diagnostics 已填满后丢弃后续输出；持久 pending 仍是 secret 前缀窗口，提交边界若落在 surrogate pair 中间则向前后退一个 code unit。新增 dense-overlap 和普通 Unicode boundary 回归测试；本机同一 `/usr/bin/time -l` 测试进程中 dense case 最大 RSS 111,050,752 bytes，空 pattern-run baseline 为 112,492,544 bytes，未再出现 occurrence 数量驱动的峰值增长。本文仍等待第六轮独立复审，不提前宣称 APPROVE。

## 13. R2b 第六轮独立审计与 EOF CPU 线性化整改

第六轮确认 32-pattern/32-KiB 与合法 64-pattern/64-KiB dense fixtures 的 RSS 都回到基线附近，33 组 confidentiality/chunk/discard/Unicode fixtures 全部通过，但仍给出 REJECT。原因是 EOF `partial suffix` 的上一版实现会从最大长度逐一递减，每次重新 `slice()` 并 `startsWith()`；对“长公共前缀、只在最后字符失败”的合法 patterns 形成 `O(patternCount × maxSecretLength²)`。审计实测单个 64-KiB pattern 需 4.57 秒和约 142.5 billion retired instructions，足以阻塞同一 daemon event loop 的 heartbeat、lease renewal 与其他 lane。

整改为每个 pattern 构建 prefix-function failure table，并只在线性扫描末尾至多 `pattern.length-1` 个 code units 时维护 KMP 状态；遇到完整匹配后回退到其最长 proper border，因此仍能识别 self-overlap 的 EOF partial prefix。时间为所有 patterns 的 `O(sum(patternLength))`。failure table 逐 pattern 创建，代码同时持有的 live table 为 `O(maxPatternLength)`；JS GC 可延迟回收，所以物理 RSS 暂时可能反映 `O(sum(patternLength))` 的总 typed-array 分配，但 built-in 合法上限最多约 16 MiB。失败优先门禁最初以 64 个约 8-KiB patterns 和 8-KiB near-match stdout 让旧实现运行 4.24 秒并触发 2 秒 timeout；修复后又把同一门禁加强为 64 个合法 patterns（其中一个达到 65,536 ASCII bytes，其余约 8 KiB）和 65,536-byte near-match stdout。加强后的测试体约 115 ms，完整 `/usr/bin/time -l` 进程为 0.31 秒、约 0.80 billion instructions。本轮仍等待第七轮独立复审，不提前宣称 APPROVE。

## 14. R2b 第七轮独立审计结论

第七轮结论为 **APPROVE**，未发现 P0、P1 或 P2，允许窄 R2b 正式收口。审计复测第六轮两个 CPU fixtures：单个 64-KiB near-match 从 4.57 秒、142.5 billion instructions 降至 0.20 秒、1.65 billion；64 个约 8-KiB patterns 从 4.38 秒、128.8 billion 降至 0.19 秒、1.89 billion。额外合法最大总量——64 个均为 65,536-byte patterns 与 65,536-byte near-match stdout——为 0.26 秒、4.01 billion instructions、最大 RSS 108,183,552 bytes。

独立 confidentiality/KMP-border/chunk/discard/Unicode matrix 33/33 通过；仓库定向验证 14/14 通过，覆盖 terminal proof、profile lifecycle、Worker bearer、bounded file read、prototype-safe slot、旧 revision recovery 与 daemon config v3 E2。审计确认 occurrence 数量不再放大 RSS、KMP mismatch 不重复扫描、full match 正确回退 proper border。唯一 P3 是上一节需要区分 live failure table 与延迟 GC 下的物理 RSS，已按本节前的措辞修正。

仍接受并保留四项明确边界：同 OS user 下最终 executable check→spawn 极窄竞态；probe→createRunAttempt 窗口可能留下 failed pre-launch RunAttempt、但不读 secret 且不 prepare/spawn；owner-controlled `staticEnv` 不属于自动 secret 分类保证；config v3 仍是 single-participant compatibility lane。Generic process 也尚无 OS 级 CPU/memory sandbox。以上都不阻止进入下一阶段，但不得被描述成已经完成 MultiLaneAgentHost 或生产级 hostile-runtime sandbox。
