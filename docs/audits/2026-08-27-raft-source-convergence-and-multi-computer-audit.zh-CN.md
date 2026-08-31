# Raft 源码收敛与多 Computer 架构审计

状态：**Accepted as implementation policy / M1 loopback complete, M2 signed release + authenticated K two-slot process handoff black-box complete, installer/reboot recovery pending**（2026-08-28）。

本文决定 RAH OS 如何在个人、闭源部署范围内吸收已获授权分析的 Raft 实现。授权范围来自项目所有者的明确说明；本文只记录工程边界，不替代授权文本或法律判断。

## 1. 结论

目标拓扑成立：一个 Room Kernel server 可以连接本机和远程的多个 Computer；每台 Computer 运行独立 AgentHost 与多个 Provider runtime；位于不同 Computer 的长期 Agent 身份可以加入同一个 Room。

但实施原则不是“Raft 版本更新，所以覆盖 RAH OS”。源码选择以模块为单位，只有同时满足来源、语义、测试和安全门槛的 Raft 实现才允许移植。当前结论是：

- RAH OS 的 Room ledger、Task/Thread、Inbox/Activation/Outbox、Placement、终止证明和版本化 application port 保留；
- Raft 的 Computer 常驻服务、连接恢复、runner 管理、Provider driver、standing prompt、CLI/MCP transport、workspace 与迁移实现优先作为移植候选；
- Raft server 未公开或无法从客户端 bundle 完整证明的控制面，按已观测合同在 RAH OS 中重新实现；
- Raft HTML/CSS/浏览器行为是产品和交互监督基线，不是 Kernel 或 transport 代码来源；
- 任意移植必须通过 RAH OS 的因果、身份、租约、终止证明和无 transcript 业务判定门禁。

因此，这不是把 RAH OS 改造成 Raft 的旧式内核，而是在 RAH OS 更严格的业务内核之上吸收 Raft 更成熟的边缘执行与产品经验。

## 2. 已确认的目标拓扑

```text
Web / PWA / future native app
             |
       Human Client API
             |
   Room Kernel server (canonical)
      |                 |
Computer A            Computer B
AgentHost A           AgentHost B
  |      |              |      |
Codex  Claude         Kimi   OpenCode
  |                      |
Agent Alice            Agent Cindy
      \                  /
       members of one Room
```

Room membership 与 Computer placement 正交：

- Room 决定谁收到消息、谁可回复以及 Task/Thread/ACL；
- AgentDefinition 决定长期身份与行为版本；
- ExecutionPolicy 决定允许在哪些 Host/runtime/model 上运行；
- PlacementDecision 决定某一次 RunAttempt 实际使用的 Computer、runtime、model 与 workspace mount；
- Computer 离线只阻止其承载的 Run，不删除 Agent、Room、消息或 Task。

Raft 官方文档当前把 Agent workspace 固定在 Computer 上，并声明 Agent migration 尚未支持。RAH OS 不应因此把 Agent 身份永久绑死到一台机器；可在创建 Agent 时生成默认 pin policy 以复现 Raft 的可见行为，同时保留未来经策略和 workspace 证明迁移的能力。

## 3. 证据与来源优先级

### 3.1 当前来源

1. Raft Computer `1.0.18` 的本机 SEA bundle 与提取出的 first-party module slices；
2. `@botiverse/raft-daemon@1.0.17` 的公开 npm 编译包；
3. Raft 官方 docs、博客、安装脚本和 live Web 行为；
4. 早期 `@slock-ai/daemon@0.2.1` 发布的原始 TypeScript；
5. RAH OS 当前源码、设计文档和可重复测试。

本机取证工作区位于独立仓库：

```text
/Users/sun/Code/repos/raft-runtime-forensics
```

生产代码不得从该路径运行时导入。它只保存证据、hash、版本和候选源片段。

### 3.2 来源解释

- `raft-computer 1.0.18` 最接近当前行为，但提取文件仍是 bundle 中的编译片段，失去原始类型、模块 import、注释和测试；
- `raft-daemon 1.0.17` 较易阅读，但同样是编译产物，package 声明的部分 TypeScript export 没有随包发布；
- 早期 Slock TypeScript 适合确认谱系和原始意图，不适合作为当前实现基础；
- 当前 npm 历史和 Web/SEA 资产未发现可用 sourcemap，不能假定存在完整原始仓库；
- 浏览器 computed style、DOM 和交互可证明产品行为，不能证明服务端事务或权限实现。

优先级不是简单的“新版本覆盖旧版本”：行为以最新官方实现为先，代码可维护性以能恢复清晰 owner、类型和测试的实现为先。

## 4. 模块裁决

| 模块                                             | 当前裁决                                     | 原因                                                                                                            |
| ------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Room event ledger、sequence、idempotency         | 保留 RAH OS                                  | 已有 canonical transaction、stale-context fence 和重放门禁；客户端 Raft 代码无法证明更强 server 事务            |
| Message、Thread、Room membership、ACL            | 保留 RAH OS；对齐 Raft 产品行为              | RAH OS 已把 membership 与投递绑定，mention 只提升 attention；需要继续补产品 surface，不替换 owner               |
| Task、InputRequest、Review 状态                  | 保留 RAH OS                                  | Task 与进程生命周期正交，Human completion 和 causal worker command 比 UI 推断更严格                             |
| Inbox、Activation、Outbox                        | 保留 RAH OS                                  | 已有 durable range、lease、ack 和 content-free wake；不得退回“收到 WS 即完成”                                   |
| RuntimeProfile、Offer、Placement                 | 保留 RAH OS；吸收 Raft probe/检测实现        | RAH OS 的 immutable provenance、capacity reservation、generation fencing 更完整                                 |
| POSIX process supervisor                         | 保留 RAH OS；对照 Raft 运维行为              | 已有签名 terminal result、process-group cleanup、recovery/quarantine 测试                                       |
| Computer 安装、setup、attach、start/stop、doctor | 移植/适配 Raft                               | Raft 当前实现覆盖常驻服务、多 server attachment、legacy adoption、升级与自恢复                                  |
| Computer service/runner 状态机                   | 优先移植，经 RAH contract 重写边界           | Raft `service`、`runners`、reconcile、handoff/convergence 是当前明显成熟区                                      |
| Provider native drivers                          | 优先移植                                     | Raft 覆盖 Claude、Codex、Kimi、OpenCode、Gemini、Pi 等真实 session lifecycle；RAH OS 当前主要是 Generic process |
| Provider session resume/steer/cancel             | 优先移植，但只产出 opaque ProviderSessionRef | 不能把 Provider transcript 变成 Room truth，也不能绕过 Worker business command                                  |
| standing prompt compiler                         | 移植为版本化 ContextManifest producer        | 需拆出 Raft server URL、账号和私有 API 假设；生成结果必须可审计                                                 |
| 内嵌 `raft` CLI transport                        | 移植为 activation-scoped worker client       | 使用 RAH Worker API、短命凭证和 actor-free command，不复制 Raft server endpoint                                 |
| managed MCP adapter                              | 移植执行端，重写控制端                       | 本机代理、配置注入可复用；server assignment、ACL、secret owner 必须由 RAH Kernel 实现                           |
| workspace、memory、notes                         | 选择性移植                                   | 文件布局与 prompt 兼容可复用；scope、provenance、promotion、retract 仍由 RAH Context protocol 拥有              |
| Agent migration                                  | 暂不直接启用                                 | docs 声明未支持，但当前 bundle 存在 migration module；需先证明 server contract 和失败恢复                       |
| External Agent bridge                            | 按 Raft 行为适配                             | 外部 runtime 可自主管理，但仍通过相同 Room membership、cursor 和 command protocol                               |
| Raft Web UI                                      | 继续作 reference snapshot 与真实浏览器基线   | CSS/icon/font/state 可提取；业务调用必须走 RAH Client，不直接依赖 Raft API                                      |
| Raft server collaboration/control                | 在 RAH OS 重写                               | 当前没有完整、可验证的 server 源码；不能由 Web bundle 猜出 canonical transaction                                |

## 5. 为什么不能直接把 bundle 作为核心依赖

Raft Computer/daemon 的当前代码非常有价值，但直接把编译 bundle 放入生产依赖会引入以下问题：

1. first-party 与第三方 vendored code 边界不稳定；
2. 原始 TypeScript 类型、测试和构建配置缺失；
3. 代码假设 Raft 的远程 API、凭证、路径和 server object；
4. 某些 package export 指向未发布源码；
5. 版本升级只能整包 diff，无法证明某个行为变化是否安全；
6. 业务逻辑可能通过 Raft server 隐式完成，移入 RAH 后会形成第二个 truth owner。

正确流程是：定位 first-party 模块与版本 → 建立行为 fixture → 恢复最小类型化模块 → 接入 RAH port → 做差分/故障测试 → 才允许替换旧实现。

## 6. Raft 代码进入生产的七个门槛

每个候选模块必须同时满足：

1. **来源明确**：记录产品版本、bundle/package hash、原始 module path 和提取方式；
2. **first-party 边界明确**：不得无意识复制依赖包或平台 shim；
3. **owner 唯一**：不得在 UI、Kernel、AgentHost 中各建一套状态；
4. **后端解耦**：不得硬编码 Raft URL、endpoint、cookie、server ID 或账号语义；
5. **RAH 不变量通过**：actor、sequence、idempotency、lease、fencing、terminal proof 不得弱化；
6. **测试不退化**：至少覆盖正常、重放、断连、过期、崩溃恢复、取消和版本不匹配；
7. **维护性提升**：恢复明确类型、窄接口和模块边界，不能只因“更接近官方”接受更大的不可读代码。

任何一项未满足时，Raft 代码只能作为参考或测试 oracle，不能成为生产依赖。

## 7. 多 Computer 的 RAH owner 模型

### 7.1 Kernel-owned 对象

- `ComputerAttachment`：一台设备与一个 RAH server 的可撤销绑定；
- `HostCredentialRevision`：绑定 Computer/Host 的凭证修订，不允许客户端自报 actor；
- `HostInstance`：一次在线 generation、heartbeat、version 和 drain 状态；
- `RuntimeOfferObservation`：由 Host 发布、带 TTL 和证据 digest 的 redacted 能力；
- `ComputerOperation`：restart、upgrade、drain、detach 等可审计控制操作；
- `PlacementDecision`：某次执行的 immutable winner；
- `WorkspaceMountObservation`：Host 对 canonical WorkspaceDefinition 的受控映射证据。

### 7.2 Computer-owned 对象

- 安装版本、service 状态和本机升级协调；
- Provider 可执行文件 probe、runtime registry 与 secret loader；
- 本机 workspace mount、process supervisor 与 terminal proof；
- server attachment 的本机凭证材料；
- runner reconnect/backoff/reconciliation 状态。

### 7.3 不允许的合并

- Computer heartbeat 不能证明 Run 完成；
- UI online dot 不能证明 Host 有有效 Placement authority；
- RuntimeOffer 不能自我升级为 server certification；
- Computer 删除不能隐式删除 Agent、workspace 或 Room history；
- Agent 加入 Room 不能修改 placement；
- placement 改变不能改写历史 RunAttempt provenance。

## 8. 远程协议方向

Computer 与 server 复用现有 command/sync/hint 思路，但使用独立 Host application port：

```text
pair/attach
  -> device challenge + Human approval
  -> HostCredentialRevision

connect/reconnect
  -> version/capability negotiation
  -> host generation claim
  -> sync pending ComputerOperation / Placement
  -> publish redacted Offer + heartbeat
  -> subscribe content-free hint

run
  -> pull Placement
  -> atomic claim
  -> prepare + terminal-proof supervisor
  -> explicit Worker Room/Task commands
  -> persist terminal proof
  -> finish RunAttempt / resolve Activation
```

WebSocket 只可降低延迟。断线后必须从 server cursor 和 durable lease 重建；不能依赖内存 pending map。正式 LAN/Internet 模式必须加入 TLS、设备配对、rotation/revocation 和明确 allowed origins；开发 fixture 的无 token HTTP 不能成为正式 Computer attachment。

## 9. 实施顺序

### M0：证据冻结与差分 harness

- 为 Raft Computer 1.0.18、daemon 1.0.17 和选定模块保存 hash/provenance；
- 建立 setup、runner crash/backoff、disconnect/reconnect、agent start/deliver/stop 的行为 fixture；
- 区分 Raft 可见行为、Raft 客户端内部实现和无法证明的 server 行为。

### M1：Remote Computer control contract

- 先在 protocol/application port 建立 attach、generation、heartbeat、offer、operation 和 placement pull contract；
- 用 fake remote Host 做双 Computer 测试；
- 不改 Web UI，不引入真实 Provider，不开放公网。

退出条件：两个独立进程、两个 Host generation 能向同一 Kernel 注册并发布不同 RuntimeOffer；断线、旧 generation 和过期 credential 均 fail closed。

当前实现证据：

- `@rah-os/computer-protocol` 已冻结 control API v1 的 session、heartbeat、RuntimeOffer、Placement claim 和无正文 hint schema；
- `ComputerApplicationPort` 只暴露 Host authentication、heartbeat、Offer publication、atomic Placement claim，以及 generation-fenced 的 Activation/RunAttempt/runtime lifecycle mutation；不暴露 credential provisioning、Human/Worker 业务 mutation 或任意 shell；
- `ComputerApplicationService` 将长期 Host credential 交换为短期、TTL-bound session token，相同 connection 重放幂等，竞争 generation 在 server stale policy 前拒绝；
- 进程内 fixture 已让两个 Host session 分别发布 Offer，并由不同 Computer generation 领取同一 Room 内两个 Agent 的 Placement；旧 generation、credential revoke 和 session expiry 均 fail closed；
- 隔离 loopback HTTP transport 只接受严格的 `/v1/computer` schema 和 Bearer 身份，不暴露 Kernel；两个独立 Node Computer 进程已完成 session open、Offer publication、Room 内双 Agent Placement claim，以及 prepare/start/renew/terminal/finish/retry；
- 同一 transport gate 已证明 Computer 显式 offline 后可由新 connection 建立新 Host generation，旧 session 立即返回 `401`，新 generation 才能继续领取工作。

因此 M1 的 protocol、application port 和 loopback 独立进程证据已经满足。短 session 现在用稳定 attachment `connectionId` 与本次进程 `computerInstanceId` 分层：同进程续签保持 generation，新进程仍按 stale/offline takeover 换代。共享 AgentHost 的真实 HTTP gate 还证明了 prepare 后 session 过期可续签；真实 child runtime 只取得 activation-scoped Worker origin/token，经 Worker HTTP 同步 canonical Room 后完成 terminal proof，terminal reap 会等待 token revoke 尝试。ComputerOperation 也已通过同一短 session 的 capability-gated pull/ack 接入，不再属于缺失的 sync 主路径；缺少的是降低延迟的 content-free hint。它仍不是远程 Computer 产品：当前 transport 刻意只绑定 `127.0.0.1`，还没有跨机器可达的 HTTPS Worker endpoint、设备 pairing、content-free push transport、TLS/rotation 或非正常 socket 中断后的 resident process 恢复。

### M2：Raft Computer service/runner 适配

- 移植 service、runner、reconcile、backoff、doctor 和 managed upgrade 的窄状态机；
- 将 Raft API client 替换为 RAH Host application port；
- 保留 RAH terminal proof、lease 和 quarantine，不采用进程 exit 推断。

当前第一切片证据：

- 已从 Raft Computer 1.0.18 的 `service.ts`、`serviceReconcileLoop.ts`、`runnerStateMachine.ts` 和 `health.ts` 提取可观察 conformance：spawn 不等于 ready、连接 marker 才进入 running、异常退出退避 2 秒、60 秒内 3 次 crash 后 degraded、configuration/unlinked terminal 不自动重启、operator reset 后才恢复；
- `@rah-os/agent-host` 新增 transport-neutral 的 `resident-runner-policy` 纯 reducer，保持现有 AgentHost 为唯一生命周期 owner，没有另建 Computer daemon truth；
- reducer 只接受结构化 terminal reason、exit code 和 signal，不解析 stdout/stderr；每次 spawn 生成本地 process generation，旧 generation 的 ready/exit 迟到事件不能改变 replacement；
- conformance 测试已覆盖显式 ready、退避窗口、crash circuit、配置/解绑停车、desired stop 和迟到事件 fencing。
- owner-private `ResidentRunnerStateStore` schema v2 用同目录临时文件、file fsync、atomic rename 与 directory fsync 持久化 policy、generation、wrapper PID、control capability、crash/degraded 证据；symlink、非私有权限、截断 JSON、未知字段和新 schema 均 fail closed；
- `ResidentRunnerSupervisor` 先取得一个尚未启动 target 的 prepared wrapper，只有 generation-bound UUID、256-bit control token 与 wrapper PID 已原子落盘后才调用幂等 `launch`；父进程启动时 active state 先进入 `recovering`，只接受 authenticated control status 或签名 terminal result，单独持久 PID 不能触发 adopt、kill 或 replacement；
- `NodeResidentRunnerControlPlane` 以 owner-private Unix socket、constant-time token 校验、严格 IPC ready/terminal fact 和 HMAC-SHA256 terminal result 驱动真实独立 OS child；绝对 command/cwd、显式最小 env 与 `shell:false` 已覆盖，control config/token 不会进入 target 环境，stdout 打印 `connected` 不能改变 lifecycle；
- 独立 AgentHost fixture 已在 target running 后被真实 `SIGKILL`；detached wrapper/target 继续存活，replacement 进程使用同一 durable capability 恢复并停止原 generation。错误 token、篡改 terminal MAC、错误 PID 和旧式 PID-only state 均 fail closed，签名 terminal result 可在 wrapper 退出后重放。
- `ComputerAttachmentStore` schema v1 已把多个长期 attachment credential 与稳定 `connectionId` 原子保存到 owner-private catalog；重复 identity、symlink、宽松权限、损坏/未来 schema 和非 loopback 明文 origin 均 fail closed。该文件存储是当前本机安全下限，不等价于未来 Keychain。
- `ComputerResidentService` 只依赖 transport-neutral `ComputerControlClientPort`，以 5 秒 cadence 执行 session open → online heartbeat → RuntimeOffer publication，并为 claim/execution command 和 Worker credential issue/revoke 在短 session `401` 后执行一次同 generation 的自然幂等重试；session-open 的长期 credential revoke 进入 `attachment_revoked` terminal。`ComputerAttachmentManager` 并行维护多个 attachment，单 attachment terminal 不拖垮其他连接，catalog revision 改变才替换被停车的实例。Computer 控制面只转交短命 Worker bearer，不向 runtime 暴露长期 Host attachment 或 Computer session token；Worker 每次请求仍由 canonical execution fence 重新授权。
- `AgentHostControlPort` 已把原 AgentHost 对本地 Kernel 的直接同步调用收口为唯一异步 lifecycle owner；Kernel adapter 与 remote Computer adapter 共用相同的 probe、prepared-before-running、lease maintenance、cancel、terminal proof、finish、complete/retry/quarantine 流程。远程 adapter 对 legacy leasing 和尚未实现的 orphan recovery fail closed。
- `RemoteComputerAgentHostService` 已把单 attachment 的 resident 与固定容量 AgentHost workers 收口为一个启动/停止 owner：identity/Offer reconcile 先于 claim，关闭先 drain runtime 并保留 terminal-proof control，再让 resident offline；失败会联动停止同一 composition，但不建立第二套 Placement 或 runtime truth。
- `NodeHttpComputerControlClient` 只允许 numeric loopback cleartext，其他 origin 强制 HTTPS；严格解析 request/response、流式限制响应为 256 KiB，按 unauthenticated/conflict/unavailable/protocol 分类且不回显 server body。真实本地 HTTP fixture 已贯通 resident service 的 session、heartbeat、Offer、claim 与 graceful offline。
- credential-safe `ComputerDoctor` 已区分 unconfigured、retryable disconnect 和 revoked/configuration terminal；`ResidentRunnerArtifactCollector` 只有在调用方显式确认 retired、UUID、owner-private、terminal evidence、保留期、非 active 且 control socket 不可连接全部成立时删除旧实例，未确认 retirement、活 socket 与未知内容必定保留。

ComputerOperation coordination 已新增持久单飞 server owner、`managed_operations` capability、loopback HTTP/Node client/Resident pull 与 typed acknowledgement。restart 在领取时冻结 source build，upgrade 冻结 target build；中途崩溃只允许同 credential、同 source build 的 generation 续接，terminal `ready` 必须来自另一 successor generation 并与 heartbeat 精确一致。本机 `ComputerOperationReceiptStore` 在 effect 后先记录 `pendingPhase` 再 ack，响应丢失只重放 ack；`ManagedComputerOperationExecutor` 的 effect port 只接受 operation/build identity，不接受远程 URL、path、shell 或日志。测试已覆盖完整 upgrade phase、restart source-build、pre-restart generation 接续、successor ready、ack 歧义和 bounded failure。

M2 现已增加固定 Ed25519 trust root 的 release manifest verifier 和 exact artifact downloader：strict semver、platform target、安全文件名、signed size/SHA-256、256 KiB manifest 上限、HTTPS、0600/0700 staging、no-overwrite publish、file/directory fsync 与 idempotent byte readback 均有门禁；不会以 Content-Length 替代 manifest size。metadata request、artifact 总下载和单次 stream stall 使用独立 deadline，持续 trickle 不能绕过总时限，完全停滞也会快速失败。候选 service attestation 与 singleton ownership 合并在同一个 owner-private Unix socket：候选以一次性 256-bit token 对 challenge 返回 source PID、candidate PID、build、Computer instance、service generation 和完整 attachment identities 的 HMAC。`ComputerServiceReplacementCoordinator` 只有在全部完全匹配后才能 commit；失败执行 TERM/KILL 和 incumbent ownership restore，无法杀死候选时进入 `recovery_required` 并拒绝恢复双主。真实 Node child gate 已覆盖成功接管和错误 build 回滚。

该切片现已冻结 `@botiverse/k-carrier@0.1.6` 的 npm tarball、tag `v0.1.6`、commit `f0f0aa8722c868fb82a76c0191dc02929cd6a21e` 和完整上游测试仓库。官方 npm 包直接导出 `node_modules` 内 `.ts`，原生 Node 25 无法执行，因此按 Apache-2.0 导入 `@rah-os/k-carrier` workspace；package metadata、type-only specifier、已验证产物 materializer、只读 release bootstrap 和 K-owned experiment executable staging 的本地适配均登记在 `packages/k-carrier/SOURCE.md`。`KCarrierComputerUpgradeCoordinator` 已以 K WAL/slots 为唯一 local transaction owner；RAH receipt 只作 Server delivery checkpoint。durable single-flight request、空环境 detached launcher primitive、process-body recovery runner、production HostAdapter、authenticated PID/generation-fenced hold/release/stop control 和只从 K slot 启动、FD 传配置的 launcher 已由唯一 Node composition factory 收口。真实 detached-process black-box 通过 0600 FD 配置和空环境启动完整 coordinator composition；request 额外冻结 operation-owning attachment，协调器只用该 attachment 重建 Server short session。它停止独立 incumbent singleton、从 K slot 启动 successor、promote stable 并恢复相同 attachment；successor 进程必须以自己的 PID、Computer instance、target build 和 singleton HMAC attestation 再提交 ready，之后才清除 K、Server 与 launch request receipt。

这仍不是安装完成的自动升级产品：现已有 service-start recovery、coordinator handoff `SIGKILL` → stable rollback 黑盒、launchd-owned constant supervisor、authenticated stop/start、FD3 config、FD4 parent lease、`plutil`-valid plist 与不调用 launchctl 的 staging installer。当前系统 Node 可执行文件依赖相对动态库，正式 release 必须是自包含 SEA 或具有签名 dependency closure 的 bundle，不能只复制一个动态链接 binary。真实 launchctl/login/reboot/power-loss、跨机器 HTTPS Worker endpoint、显式 re-attach/operator reset、Keychain 与正式远程 Computer CLI 仍未实现，因此 M2 继续进行。当前证据不是签名安装、主机断电恢复或正式 LAN Computer 产品证明。

最新收口把 upgrade process 配置升级为 schema v2 并强制 supervisor control；正常 promotion 与 coordinator `SIGKILL` recovery 黑盒都不再走 direct-slot fallback。supervisor 新增 authenticated status、hung/late launch deadline fence；统一 `rah-os-computer` 内部 dispatch 已精确覆盖 supervisor、service 和 detached upgrade。另有 fixed-path/no-shell/no-parent-env 的 launchctl activation controller，可精确区分 exit `0`、missing `113` 与 ambiguous failure，并把 launchd registration 后的 child PID 绑定到 singleton HMAC readiness。该 controller 只在 fake port 上验收，没有操作用户登录域；自包含签名 bundle、installer-facing provisioning 和真实 reboot/power-loss 证据仍未完成。

service process 的生命周期壳已由 `runNodeKCarrierComputerServiceProcess` 收口：attachment workload、live singleton attestation、attachment identity compare-and-hold/release、startup recovery、signal 与 parent lease 都由同一 owner 管理。新增 workload readiness barrier 后，未完成 parked/catalog 初始化的进程不能提供 live attestation 或先行执行 recovery。`ComputerServiceAttachmentWorkload` 复用既有 catalog manager，负责 durable parked startup、exact hold、drain 与 release 后重建；`createRemoteComputerServiceAttachmentWorkload` 已把每个 attachment 接入独立 bounded `RemoteComputerAgentHostService`，并共享同一 service incarnation。`RemoteRuntimeProfileSet` 进一步共享 daemon 的 active revision、probe/model/Offer、secret lease 和旧 revision recovery resolver，远程 Worker credential 仍只按 Activation 签发；远程 orphan recovery control 仍未进入协议。production service strict config v1 只从 FD3 读取，打开/probe active RuntimeProfile、绑定 Workspace/file-secret reference、组装 catalog workload，并在 readiness 后执行 K startup recovery；FD4 只允许 pipe/socket parent lease，配置不存在 inline command/env。detached 正常升级与 coordinator crash recovery 均复用同一生产链。剩余 release 缺口是自包含签名 artifact、provisioning、真实 launchctl/reboot 与 Keychain。

### M3：远程 Placement 闭环

- placement hint 不含消息正文；
- Computer 主动 pull、claim、renew 和 report terminal proof；
- 验证一台 Computer 离线时另一台继续工作，同一 Agent lane 不双跑。

### M4：Provider driver

优先顺序：Codex → Claude → OpenCode → Kimi；其他 runtime 只有在前四个的 session/resume/cancel/recovery contract 收口后进入。

- 先建立 Raft-vs-RAH conformance fixture；
- driver 只拥有 Provider lifecycle 和 structured observation；
- Room reply、Task、InputRequest 和 Artifact 必须通过 Worker API 显式发布；
- ProviderSessionRef opaque、可冻结、不可改写历史 Placement。

### M5：Prompt、workspace、memory、MCP

- 已完成基线：Raft-conformant Workspace instruction pack protocol/transactional installer、Kernel schema v12 ContextManifest 引用冻结、远程 Computer claim 校验和真实 process 注入；Worker credential 同步改为 0600 file transport，不再向 Provider 环境暴露 bearer；每次 Activation 生成 token-free PATH-first `rah` wrapper，固定 CLI allowlist 已由真实 fake 外部进程与 SEA internal-dispatch 单元门禁覆盖，默认 prompt 不再教模型手写 bearer HTTP；managed MCP 已完成 Kernel versioned Server/assignment、Worker catalog/call、真实 Streamable HTTP executor、Provider proxy 注入、typed Human API 与 Raft 形态 Settings 首个浏览器闭环；
- 仍未完成：Artifact/Skill registry 与内容解析、pack materialization proof、完整 standing prompt compiler、Memory promotion/retract 和实际注入清单；MCP 已具备有界 usage/audit projection，仍缺 URL/secret/OAuth 管理、preset 与正式远程安全边界，因此 M5 仍为进行中；
- 移植 standing prompt 与 workspace pack 生成逻辑；
- 生成 versioned ContextManifest，记录来源、scope、hash 和实际注入项；
- 将内嵌 Raft CLI/MCP proxy 改接 RAH Worker/Tool application port；
- server 端 assignment、ACL、secret 与审计重新实现。

### M6：Raft 产品面

- Computer 页面展示真实 attachment、Host、runtime、Agent 和 operation；
- “在此 Computer 创建 Agent”只创建默认 pin policy，不建立 UI-owned binding；
- 多 Computer 的 Agent 通过标准 Room membership 加入同一聊天室；
- 所有菜单、dialog、loading/error/disabled 状态继续由 live Raft 浏览器监督，但 mutation 结果只以 canonical RAH projection 为准。

### M7：External Agent 与 native shell

- External Agent 使用同一 membership/cursor/command contract，不获得 Kernel SQLite 或任意 shell API；
- PWA、Mac shell、future iOS app 复用 Client protocol；
- native shell 只拥有安装、Keychain、通知、文件选择和 daemon control bridge。

## 10. 第一个代码切片

第一个实现切片固定为 **M1 Remote Computer control contract + fake 双 Host gate**，不是 UI、Provider driver 或 installer。

理由：

- 它直接验证目标 server/client 拓扑；
- 可以复用现有 Placement 和 AgentHost，而不污染 Room 核心；
- 后续移植 Raft runner、Provider driver 和 Computer UI 都有稳定端口；
- 使用 fake Host，不触发真实付费 Provider，也不需要重启用户现有 daemon；
- 能尽早暴露身份、generation、credential、TTL 和断线恢复问题。

当前已完成 schema、application port、loopback HTTP transport、独立进程双 Host/generation handoff、generation-safe RunAttempt/terminal-proof 命令，以及 M2 的 runner policy、durable supervisor、parent-crash reconnect、多 attachment reconcile、共享 AgentHost control owner、activation-scoped Worker/API child gate、ComputerOperation、签名 release、K WAL/slots、detached successor proof、startup recovery、handoff crash rollback、launchd constant supervisor/FD lease、strict production service composition、统一 internal CLI 和 staging installer。下一步完成自包含签名 bundle、installer-facing provisioning 与真实 launchctl/reboot/power-loss gate，再推进跨机器 Worker HTTPS、re-attach/reset 和 pairing/TLS；在正式安全边界完成前，不把 loopback transport 暴露到 LAN，也不把 Raft API endpoint 或远程 WebSocket client 直接接入 production composition root。

production Computer CLI dispatch 与 service composition 已完成 owner 收口；仍缺的是把它们封装为具有签名 dependency closure 的 artifact，并由 provisioning 命令生成一致的 service/upgrade/supervisor config。下一步完成该 artifact 与隔离登录域/reboot gate，随后推进跨机器 Worker HTTPS、re-attach/reset 与 pairing/TLS。

## 11. 当前基线证据

本审计执行时，RAH OS dirty worktree 上：

- `npm run check` 通过；
- package tests 共 424 项，423 通过，1 项 opt-in real CLI gate 跳过；
- Web unit tests 7 项通过；
- TypeScript 通过。

这只证明当前本地基线没有立即失败，不证明 remote Computer、真实混合 Provider、正式 LAN pairing 或完整 Raft 产品面已经完成。

## 12. 禁止的捷径

- 不用 Raft bundle 覆盖 `packages/kernel`；
- 不让 Web 页面直接调用 Computer 或 Provider CLI；
- 不通过解析 stdout/ANSI/Provider transcript 完成 Room/Task；
- 不让 server 远程接收任意 shell command；
- 不把 live Raft cookie、token 或账号数据写入仓库；
- 不用开发 LAN fixture 冒充正式远程部署；
- 不在没有 terminal proof 时释放 Placement 或重跑同一 Agent lane；
- 不因 UI 与 Raft 一致就声称后端交互已一致。

## 13. 官方监督来源

- [Raft Computers](https://docs.raft.build/features/server/computers/)
- [Raft Agent Runtime](https://docs.raft.build/features/agents/runtime/)
- [Raft Agent Lifecycle](https://docs.raft.build/features/agents/lifecycle/)
- [Raft External Agents](https://docs.raft.build/features/agents/external/)
- [Raft Channels](https://docs.raft.build/features/messaging/channels/)
- [Raft Messages](https://docs.raft.build/features/messaging/messages/)

这些来源用于监督功能与交互；RAH OS 的 canonical owner 与安全边界以本仓库协议、ADR 和可重复测试为准。
