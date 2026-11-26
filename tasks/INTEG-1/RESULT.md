# INTEG-1 集成结果

在 `/Users/sun/Code/repos/loom-integ1` 的 `integ/main-1` 集成。分叉点为 main 的 `0e280f39`。

| 卡片 | 源提交 | 集成提交 |
| --- | --- | --- |
| HARDEN-PS-1 | `512eac8e` | `ea7f6626` |
| Status TUI v1 和 v2 | `cf865965`、`b34d7663` | `b23fd139` |
| ROT-TUNE-1 | `c966a9d7` | `ad3f7499` |
| WORKER-REAP-1 | `8fc550c0` | `e2e45228` |
| SOCK-AUTH-1 和存量接管 | `7159aca1` | `4e39219a` |

HARDEN-PS-1 的 23 个文件由共享工作树复制到 `infra/harden-ps` 并提交。其余待提交卡片在各自工作树提交。集成提交均带 Claude Opus 5.5 的共同作者尾注。逐个核对共享工作树的 23 个文件与 `512eac8e` 字节和可执行位一致，完成转存后只移除了这批重复改动。main 工作树干净，引用保持 `0e280f39`。未推送。

## 冲突

HARDEN-PS-1 和 Status TUI 合入时没有未解决的 Git 冲突。以下列出其余每个冲突文件。

### ROT-TUNE-1

| 文件 | 解决方式 |
| --- | --- |
| `cli/history.mjs` | 同时保留 TUI 的原生会话解析结果和转录字节数。 |
| `daemon/role-budget.mjs` | 用实际窗口、上下文占用和来源计算替代旧固定预算。门禁唤醒超额通知 Super。保留给 Board 提供观测量的接口。 |
| `daemon/sessions.mjs` | 保留运行时上下文接口，合入 v2 的接任确认及对端身份。 |
| `daemon/supervisor.mjs` | 保留 TUI v2 的 Board、门禁轮次、分组通知和投递统计，使用 ROT 的共享上下文。 |
| `daemon/supervisor.test.mjs` | 保留窗宽来源和唤醒预算用例。Neon 采用 ROT 已核实的 512,000 回退窗口。 |
| `docs/research/2026-11-26-worker-lifespan.md` | 保留已审定的跨卡复用限制和压缩后再次逼近上限的条件，常驻角色政策引用 v2。 |

### WORKER-REAP-1

| 文件 | 解决方式 |
| --- | --- |
| `cli/loom.mjs` | Cost 帮助同时说明换班简报 token 与项目会话树 RSS，保留新派工命令。 |
| `cli/status-tui.test.mjs` | 保留旧 Board 回执过滤和新 Worker 倒计时、用量、结论及门禁统计用例。 |
| `cli/status-view.mjs` | 在 TUI v2 可缩列表与活跃优先切换中加入 Worker 生命周期和度量，Board 继续只显示待处理事项。 |
| `cli/status.mjs` | JSON 同时暴露轮换详情、已退役 Worker、缓存倒计时、门禁统计和 RSS。 |
| `daemon/host-client.mjs` | 保留宿主处理未知存活的逻辑及身份字段。 |
| `daemon/processes.mjs` | 同时保留保守的宿主存活判断和按进程树去重的 RSS 统计。 |
| `daemon/processes.test.mjs` | 保留缺行、EPERM、ESRCH、PID 复用和 RSS 归属回归。 |
| `daemon/self-rotation.mjs` | 旧模式保留失败继任的收尾回执，v2 延用自身的核实、回退和阶段锁。 |
| `daemon/sessions.mjs` | 合并继任首轮格式、Worker 派工基线、缓存恢复、角色判断和窗口接口。 |
| `daemon/supervisor.mjs` | 同一投递循环内先核验 Worker 起跑基线，再评估干净边界。合并 Worker 生命周期、Board 与换班和回退处理。常驻角色的压缩次数阈值保留显式配置，v2 不采用独立的单次压缩触发器。 |
| `docs/research/2026-11-26-worker-lifespan.md` | 使用最终通过的 Worker 阈值。常驻角色引用 ROT v2。 |
| `inbox/engine.mjs` | 同时保留投递状态观察和继任改投、作废接口。 |
| `skills/loom/SKILL.md` | 保留旧工作续作、Worker 生命周期流程、ROT 交接和固定 SHA 门禁授权。 |

### SOCK-AUTH-1

| 文件 | 解决方式 |
| --- | --- |
| `cli/loom.mjs` | 保留 v2 登记和 Super 的被动换班参数。 |
| `cli/send.mjs` | 发信人由认证身份决定，继续传递跨卡复用和派工理由。 |
| `daemon/hardening.test.mjs` | 保留隔离 HOME 和进程检查，另在临时目录建立独立测试认证状态。 |
| `daemon/main.mjs` | 统一使用 SOCK-AUTH-1 的能力凭证及旧会话对端回退。移除 ROT 单独的终端识别入口。 |
| `daemon/rpc.mjs` | 同时传递能力凭证并保留恢复及投递的较长超时。 |
| `daemon/self-rotation.mjs` | 支持经认证的外部 Super 指定目标，保留 v2 的被动接任和字段检查。 |
| `daemon/sessions.mjs` | 合并 Worker 生命周期、旧会话对端证明、能力凭证及宿主存活未知保护。已下线 Worker 无活动会话权限。 |
| `daemon/supervisor.mjs` | 同一认证身份用于派工、换班、写锁、发信和停机。保留 Worker 的关闭原因及角色归属。 |
| `daemon/supervisor.test.mjs` | 合并旧会话和凭证测试与两类轮换、Worker 复用、原生压缩证明。 |

## 集成回归

初次全量通过 763 项，随后一次默认并发复跑在回滚后未能及时重新挂接 Codex pipe holder。定向回归注入进程表查询失败，复现了已有 holder 被过度依赖 `ps` 与恢复进程读到过期换班状态两类问题。`f6ff6e9f` 保留经校验的已登记 holder，收到可证实的死亡或身份冲突才拒绝。恢复进程在退出前重新核对持久化交接状态，避免因异步存活检查返回较晚而退出。

## Reviewer 迁移

SKILL-VERIFY-1 的完整实现未在本次合并范围内。集成分支移除 Reviewer 的创建入口、活动授权、门禁配额、门禁裁决段和成本角色行。Auditor 在阶段边界核查原件，可采用 Worker 的证据卡。旧配置加载时警告并忽略 `roles.reviewer`。已持久化的查询记录仍可读。

## 验证

- 在集成工作树执行 `npm ci`。代码提交 `f6ff6e9f` 连续两次运行 `npm test -- --test-concurrency=4`，各 763 通过，0 失败、0 取消、0 跳过。`git diff --check main...HEAD` 通过。
- 从未经修改的 `8fc550c0` 归档启动临时项目。Leader、Auditor、Worker 的原生 PID 和会话标识在切换后保持一致。Leader 打包门禁和升级红色事项，Auditor 登记决策，Worker 执行基线核查和发送。角色伪造和显式无效的能力凭证被拒。无换班记录。
- Worker 的空闲起点在升级前后相同，剩余时间从 14,840 ms 降至 12,050 ms，16 秒 TTL 到期后下线。状态 TUI 在同一进程中观察 14 次暂时的 Board 请求失败，显示重连状态后恢复原 Leader 与 Auditor。在最终代码上单独复跑归档演练通过。演练使用隔离 HOME、临时项目和虚拟 CLI。 [热升级夹具](../../daemon/upgrade.test.mjs)

STATUS: done
