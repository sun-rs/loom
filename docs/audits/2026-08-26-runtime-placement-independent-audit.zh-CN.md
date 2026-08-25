# Runtime Placement 与下一阶段独立审计（2026-08-26）

状态：**三路初审与整改后复审完成；R1/R1.1 仍为 provisional，已达到进入窄 R2a 的本机门禁。**

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
