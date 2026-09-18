# R8 子进程环境的定向隔离（2026-09-16）

## 工作项与裁决

施工单 `docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §6 R8
「子进程环境的定向隔离」，对应
`docs/audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md` Top-12「HOME/cwd」行的
后半句：「HOME 不隔离是用户选择。宿主环境秘密另立明确威胁测试」。

裁决：**成立，已修复**。基线 `98dc095` 的
`packages/agent-host/src/generic-process-adapter.ts` 把 `process.env` 整份继承给每
个 Provider 子进程，只逐名删除约 15 个 Worker/memory/inbox carrier。daemon 自身的
服务凭据与部署位置（`RAH_DATA_HOME`、`RAH_STATE_DIRECTORY`、`RAH_LAN_KEY_PATH`、
`RAH_WEB_PORT`、`RAH_RESIDENT_RUNNER_TOKEN` 等）不在该名单内，全部到达子进程。

范围裁决（按用户已定决定，不得撤回）：

- **保留** Provider 登录与 HOME 行为。不引入 per-Agent HOME，不做默认文件沙箱，
  不因 `CODEX_HOME`/`CLAUDE_CONFIG_DIR` 存在就判越权。
- **不改成白名单。** 只剔除 RAH 自己的命名空间；`RAH_` 之外的继承环境一律保留。
- direct 与 supervised 两条启动路径行为必须一致。
- 本项是**环境卫生，不是 OS 沙箱**，报告与文档均按此表述。

## 证据

### 一、可能出现在 daemon 环境中的 RAH 变量与投递路径

盘点方法：在 `packages/daemon`、`packages/agent-host`、`packages/kernel`、
`packages/application-service`、`scripts` 中 grep `process.env.` 与 `"RAH_*"`
字面量，并读出每个名字的写入方。

| 类别                | 变量                                                                                                                                                                                                         | 投递路径                                                                                                                      | 敏感性                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 部署位置            | `RAH_DATA_HOME`、`RAH_OS_HOME`、`RAH_STATE_DIRECTORY`、`RAH_WORKSPACE_CWD`、`RAH_WEB_STATIC_DIRECTORY`                                                                                                       | LaunchAgent plist（`macos-local-core-launch-agent.ts:116-121`）、`scripts/run-local-workbench.mjs`、运维 shell                | 指向 `room.db`、Worker credential 目录与 Agent workspace 根 |
| 网络与 TLS          | `RAH_WEB_PORT`、`RAH_LAN_BIND_HOST`、`RAH_LAN_ORIGIN`、`RAH_LAN_CERT_PATH`、`RAH_LAN_KEY_PATH`、`RAH_TRUSTED_LAN_HOSTS`、`RAH_TAILNET_HOST`                                                                  | LaunchAgent plist、`local-core-cli-dispatch.ts:109-124`、`scripts/workbench-launch-mode.mjs`、`scripts/run-lan-workbench.mjs` | `RAH_LAN_KEY_PATH` 是 TLS 私钥路径；其余暴露网关拓扑        |
| 内部进程控制传输    | `RAH_PROCESS_SUPERVISOR_CONFIG`、`RAH_PROCESS_SUPERVISOR_TOKEN`、`RAH_RESIDENT_RUNNER_CONFIG`、`RAH_RESIDENT_RUNNER_TOKEN`、`RAH_RESIDENT_PROCESS_GENERATION`                                                | adapter → supervisor（`generic-process-adapter.ts` supervised spawn）、`node-resident-runner-control-plane.ts:134-138`        | 256-bit 控制 token，可对受监管进程发 launch/terminate       |
| Worker capability   | `RAH_WORKER_API_URL`、`RAH_WORKER_SESSION_FILE`、`RAH_WORKER_CLI`、`RAH_AGENT_TOOL_BIN`、旧 `RAH_WORKER_TOKEN[_FILE]`                                                                                        | Activation environment lease（`worker-tool-transport.ts` / `worker-credential-file.ts`）                                      | 受控载体；bearer 只进 `0600` session file，从不进环境       |
| Agent 记忆/收件箱   | `RAH_AGENT_MEMORY_DIR`、`RAH_AGENT_MEMORY_INDEX`、`RAH_AGENT_MEMORY_BOOTSTRAP_JSON`、`RAH_AGENT_MEMORY_SOURCE_FILE`、`RAH_AGENT_APP_INBOX_JSON`、`RAH_AGENT_INBOX_API_URL/SESSION_FILE/CLI`                  | Activation environment lease（memory coordinator / app inbox transport）                                                      | 跨 Agent 泄漏即记忆越权                                     |
| Activation 身份围栏 | `RAH_ACTIVATION_ID/REASON`、`RAH_CONSUMER_ID`、`RAH_HOST_ID`、`RAH_PARTICIPANT_ID`、`RAH_ROOM_ID`、`RAH_RUN_ATTEMPT_ID`、`RAH_FROM_SEQ`、`RAH_TO_SEQ`、`RAH_AGENT_CONTEXT_JSON`、`RAH_CONTEXT_MANIFEST_JSON` | adapter 每次启动最后写入                                                                                                      | 被覆盖即身份伪装                                            |
| 启动配置            | `RAH_PROVIDER_LAUNCH_ARGS_JSON`                                                                                                                                                                              | `runtime-guide-settings.ts:102` 随用户 per-Agent 环境一起进入 lease                                                           | 决定 argv 策略                                              |
| 运维/构建           | `RAH_OS_BUILD_IDENTITY`、`RAH_DAEMON_AGENT_START_INTERVAL_MS`、`RAH_DAEMON_MAX_CONCURRENT_AGENT_STARTS`                                                                                                      | 运维 shell / 构建注入                                                                                                         | 非凭据，但属 RAH 内部，无需投给 Provider                    |
| 门禁与 fixture      | `RAH_FIXTURE_*`、`RAH_BROWSER*`、`RAH_UI_*`、`RAH_*_EVIDENCE`、`RAH_VIEWPORT_WIDTH` 等约 40 个                                                                                                               | `scripts/run-*-gate.mjs`、证据脚本                                                                                            | 会污染子进程且暴露本机证据路径                              |

从这张表得出的结论：**没有任何一个 `RAH_` 变量需要由 Provider 子进程通过“继承”
获得**。身份围栏由 adapter 最后重写，capability 由 Activation lease 重新注入，
`RAH_FAKE_*` 之类测试变量走 RuntimeProfile 静态配置层（`GenericProcessAdapterOptions.env`），
不经过继承。因此对继承层按 `RAH_` 前缀整段剔除是安全的，且比逐名 denylist 更不易
随新变量出现而失效——基线的 15 条名单正是这样过时的。

### 二、基线泄漏复现（实现前）

在 `process.env` 中注入四个 canary 后用真实 supervised 路径启动 `node -e` 子进程，
子进程打印自身环境中含 `CANARY-` 的键（完整输出见
`scratchpad/batch-a/reports/R8-baseline-leak.txt`）：

```
✖ baseline: current adapter leaks host RAH service variables
  + [ 'RAH_DATA_HOME', 'RAH_LAN_KEY_PATH', 'RAH_RESIDENT_RUNNER_TOKEN', 'RAH_STATE_DIRECTORY' ]
  - []
```

### 三、用户 per-Agent 环境覆盖的现状

`packages/protocol/src/runtime-guide-settings.ts:25-35` 的
`RuntimeLaunchEnvironmentSchema` 已拒绝 `RAH_`、`HOME`、`PATH`、`USER`、`SHELL`、
`NODE_OPTIONS`、`NODE_PATH`、`LD_*`、`DYLD_*`、`KIMI_MODEL_THINKING_EFFORT`、
`CLAUDE_CODE_DISABLE_AUTO_MEMORY`。经核实该 schema 不只在写入时生效：
`packages/daemon/src/runtime-guide-settings.ts:37-38,85-87` 在**加载磁盘状态时**也用
同一 schema 解析，因此历史写入或被手工编辑的状态文件同样过不了这道门。本次为它补上
运行时侧的同形 owner（见下），使规则不再只存在于一个 zod 定义里。

## 改动

### 新增 `packages/agent-host/src/launch-environment-policy.ts`

子进程环境的唯一 owner，四个导出：

- `sanitizeInheritedEnvironment(inherited)`：按
  `INHERITED_INTERNAL_ENVIRONMENT_PREFIXES = ["RAH_"]` 剔除继承层的整个 RAH 命名空间。
  其余一律保留：`HOME`、`PATH`、Provider 登录/配置目录、`HTTP(S)_PROXY`、`NO_PROXY`、
  `SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`、locale、`TERM`。
- `resolveActivationEnvironment({ inherited, configured, leased, fences })`：三层合并。
  ① 继承层过滤后叠加 RuntimeProfile 静态配置，再从这一“不可信层”删除
  `MANAGED_CARRIER_ENVIRONMENT_KEYS`（即基线那 15 个 carrier，保持原语义：静态配置
  也不许伪造 capability）；② 叠加 Activation lease（受控载体）；③ 最后叠加
  Activation identity fence，任何层都不能覆盖。最后统一处理
  `RAH_AGENT_TOOL_BIN` → `PATH` 置顶与旧 `RAH_WORKER_TOKEN` 清除。
- `filterUserLaunchEnvironment(env)`：用户 per-Agent 覆盖的运行时侧拒绝规则，与
  `RuntimeLaunchEnvironmentSchema` 同形（`USER_OVERRIDE_PROTECTED_KEYS` +
  `USER_OVERRIDE_PROTECTED_PREFIXES`），返回 `{ environment, rejected }`，让调用方
  可以报出被拒的键而不是静默半应用。
- `ACTIVATION_IDENTITY_FENCE_KEYS` 等常量对外公开，供 daemon 侧复用。

### `packages/agent-host/src/generic-process-adapter.ts`

只改 `#createActivationProcessEnvironment` 段：函数体由「整份继承 + 15 个 delete +
手工拼装」替换为一次 `resolveActivationEnvironment(...)` 调用；随之删掉 6 个只为那些
delete 存在的 import。两条 spawn 路径（`#startDirect` 与 `#startSupervised`）仍调用
同一个方法，supervised 路径只额外加入自己的
`RAH_PROCESS_SUPERVISOR_CONFIG/TOKEN`，且 `process-supervisor.mjs:89-90` 在启动
Provider 前把这两个删除。**没有改变** cwd、argv、HOME、lease 语义或 PATH 置顶行为。

### `packages/agent-host/src/index.ts`

新增一组导出（策略函数与类型），使 daemon 侧可以在 typed 边界之外再用同一 owner。

### 文档

`docs/architecture/runtime-adapter-and-observation.zh-CN.md`：在 L0 能力清单中新增一条
环境策略条目，写明三层规则、保留清单、direct/supervised 同源，并明确「这是环境卫生，
不是同系统用户下的 OS 沙箱」。

未触碰：`packages/protocol`、`packages/daemon`、`scripts`、`package.json`、
R4 第三轮占用的任何文件。

## 验证

TDD：先写测试、记录失败，再实现。

失败记录（实现前）：

1. `node --test packages/agent-host/test/launch-environment-policy.test.ts`
   → `ERR_MODULE_NOT_FOUND: .../src/launch-environment-policy.ts`（能力不存在）。
2. 针对**当时的真实 adapter**写的一次性 canary 探针
   → `RAH_DATA_HOME`、`RAH_LAN_KEY_PATH`、`RAH_RESIDENT_RUNNER_TOKEN`、
   `RAH_STATE_DIRECTORY` 全部出现在子进程环境中（输出存
   `scratchpad/batch-a/reports/R8-baseline-leak.txt`；探针文件用完即删，未留在仓库）。

新增 `packages/agent-host/test/launch-environment-policy.test.ts`，9 个测试：

1. 16 个 canary（服务凭据、内部 token、部署位置、`RAH_DEV_*`）全部消失；11 个开发者
   变量（HOME/PATH/CODEX_HOME/CLAUDE_CONFIG_DIR/代理/证书/locale/TERM）逐个原值保留；
   结果中剩下的 `RAH_` 键恰好等于身份围栏集合。
2. 受控 Worker 载体不变：lease 的 `RAH_WORKER_API_URL`/`SESSION_FILE` 照常到达，静态
   配置伪造的同名值被丢弃，旧 `RAH_WORKER_TOKEN` 永不出现，`RAH_AGENT_TOOL_BIN` 被
   转成 `PATH` 置顶且自身不留在环境里。
3. 静态配置与 lease 都不能覆盖 Activation identity fence。
4. `filterUserLaunchEnvironment` 拒绝 `RAH_*`、`HOME`、`PATH`、`NODE_OPTIONS`、
   `DYLD_*` 与 `CLAUDE_CODE_DISABLE_AUTO_MEMORY`，放行 `CODEX_HOME` 与 `HTTPS_PROXY`，
   并按名报出被拒键。
5. 该函数与 typed 边界 `RuntimeLaunchEnvironmentSchema` 对同一组键给出一致结论
   （受保护键两边都拒，合法 `CODEX_HOME` 两边都放行）。
6. 四类 Provider（Codex/Claude/Kimi/OpenCode）在策略产出的环境下
   `providerLaunchArguments(id, env) === providerLaunchDefaults(id)`，且
   `CODEX_HOME`/`CLAUDE_CONFIG_DIR` 仍可被发现。**未运行任何真实模型。**
7. 真实 adapter 端到端（fake `node -e` 子进程）：子进程环境中含 `CANARY-` 的键为
   空集，`RAH_` 键恰好等于围栏 + lease 投递的两个 Worker 变量，PATH 以 tool-bin 置顶，
   stdout/stderr 诊断不含 canary。
8. 启动失败路径（不存在的可执行文件）抛出的错误消息不含 canary。
9. direct 与 supervised 同源结构不变量：adapter 中
   `#createActivationProcessEnvironment` 恰好 1 处定义 + 2 处调用、恰好 2 处 `spawn(`、
   每个 spawn 的 `env:` 都取自该方法、supervised 只额外加入两个 supervisor 控制变量、
   全文件只有 2 处 `process.env`。

命令与结果：

| 命令                                                                           | 结果                          |
| ------------------------------------------------------------------------------ | ----------------------------- |
| `node --test packages/agent-host/test/launch-environment-policy.test.ts`（前） | 模块不存在，1 失败（预期）    |
| 一次性 baseline canary 探针（前）                                              | 1 失败，泄漏 4 个变量（预期） |
| `node --test packages/agent-host/test/launch-environment-policy.test.ts`（后） | 9/9 通过，0.51s               |
| `node --test --test-concurrency=1 packages/agent-host/test/*.test.ts`          | 630 个，629 通过，107s        |
| `node --test packages/agent-host/test/agent-start-coordinator.test.ts`（复跑） | 6/6 通过，0.20s               |
| `npx tsc --noEmit`                                                             | exit 0，无输出                |
| `npx prettier --write`（4 个改动源文件）+ `--check`（文档）                    | exit 0                        |

全量 630 个测试中唯一一次失败是 `agent-start-coordinator.test.ts` 的
「three Agents woken together are spaced by the minimum start interval」，断言
「39ms ≥ 40ms」——计时抖动，与本项无关；单独复跑 6/6 通过。既有的
`process-runtime.test.ts` 中三条环境相关回归（旧 Worker token 清除、App Inbox/memory
bootstrap 清除、`RAH_ACTIVATION_ID` 不可被静态配置覆盖）未改动即通过。

按指令未运行完整 `npm run check`。

## 部署

- **未部署。** 未 commit、未 push、未 npm install、未运行付费 CLI、未重启现役工作台。
- 生效方式：下一次 Provider 启动即生效，不改写活动 Run，不涉及数据库或迁移。
- **这是环境卫生，不是 OS 沙箱。** Provider CLI 仍以同一个 macOS 用户身份运行，仍
  使用用户自己的 HOME 与登录目录，仍能读取该用户可读的任何文件（包括 `room.db`
  本身，只要它猜到路径）。本次修复只保证 **RAH OS 自己不再把这些位置和凭据递过去**，
  把「随便读到」从默认行为降为需要主动探索的行为。真正的进程隔离需要独立的 OS 级
  方案，不在本项范围内，也未被本项证明。

## 剩余项

- `filterUserLaunchEnvironment` 目前是 agent-host 侧的 owner 与测试对象；把 daemon 的
  `runtime-guide-settings.ts` 启动路径改为调用它（而不是只依赖 zod schema），涉及
  批次 A 正在占用的 daemon 文件，留作集成期的一行接线。当前两道规则已由测试证明
  同形，且 schema 在写入与磁盘加载两处都生效，因此**不存在已知绕过路径**。
- 非 `RAH_` 的宿主机密（例如运维 shell 里的 `GITHUB_TOKEN`、`AWS_*`）仍会被继承。
  这是用户「不改成白名单」决定的直接后果，且 Provider CLI 在同一用户下本就能读到
  这些凭据的磁盘来源，环境过滤并不能真正拦住它们。若将来要处理，应按 OS 级隔离
  立项，而不是扩大本 denylist。
- 常驻 runner 控制面（`node-resident-runner-control-plane.ts`）走的是显式
  `targetEnv`，本就不继承 daemon 环境，本次未改动；它与 `GenericProcessAdapter` 目前
  是两套环境构造方式，尚未统一到同一 owner。
- 未做实机验收（未重启现役工作台）。四类 Provider 的验证使用 fake adapter 与参数
  发现函数，未运行真实模型。
