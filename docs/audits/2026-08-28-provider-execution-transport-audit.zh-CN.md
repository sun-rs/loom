# Provider CLI 执行传输与权限审计

日期：2026-08-28\
结论：**Multica 的 Provider-specific driver/ACP 实现最适合作为跨 CLI 执行参考；Raft Computer 的新 Kimi SDK session 证明产品级方向是长生命周期 native runtime；旧 RAH 的 Codex app-server 与 OpenCode serve 路径证明 vendor local server 比一次性 CLI argv 更适合交互式 Session。RAH OS 保留 Room/Activation/Task owner，只吸收这些 runtime transport，不复制它们的业务状态。**

## 1. 固定证据

- Multica 官方仓库 commit `64ec7f54163d918d5d7fd4dcae857f241b7842d0`（Apache-2.0）：[`kimi.go`](https://github.com/multica-ai/multica/blob/64ec7f54163d918d5d7fd4dcae857f241b7842d0/server/pkg/agent/kimi.go) 使用 `kimi acp`，执行 `initialize -> session/new|resume -> session/set_model -> session/set_config_option -> session/prompt`，并通过 ACP `session/request_permission` 应答权限；[`codex.go`](https://github.com/multica-ai/multica/blob/64ec7f54163d918d5d7fd4dcae857f241b7842d0/server/pkg/agent/codex.go) 与 [`opencode.go`](https://github.com/multica-ai/multica/blob/64ec7f54163d918d5d7fd4dcae857f241b7842d0/server/pkg/agent/opencode.go) 各自拥有独立 driver，而不是共享一套猜测 argv。
- Kimi CLI 官方源码 commit `cbc15c076d17f70fec9f89c90c0502e68657f505`（Apache-2.0）：ACP 文档明确由 client 提供 `session/request_permission` 和可选 terminal/filesystem methods；当前源码允许 `--yolo --prompt`，但本机安装的 Kimi `0.38.0` 实测拒绝 `--prompt` 与 `--yolo`、`--auto` 组合。这证明权限映射必须绑定 executable version/transport capability，不能只绑定 Provider 名称。
- 授权取得的 Raft Computer `1.0.18` bundle `main.js` SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`：保留 legacy `KimiDriver` 的长驻 wire child process，同时新增 canonical `KimiSdkDriver`/`KimiSdkRuntimeSession`，以 SDK `prompt/steer/cancel` 和 session approval handler 驱动；driver registry 明确不自动迁移旧 Agent。
- OpenCode 官方本机 SDK `@opencode-ai/sdk@1.3.7`（MIT）与本机 CLI `1.18.22` 生成类型证明 `/session`、同步 `/message`、`/event` SSE、`/permission/:id/reply`、`/question/:id/reject` 和 `/session/:id/abort` 的当前协议。旧 RAH 的 `opencode-api.ts`/`opencode-live-client.ts` 只用于对照 server 启动、HTTP/SSE 和恢复边界；生产实现是 Room-first driver，不复制旧 Session 业务层。

## 2. 采用的分层

```text
Kernel authoritative plane
Room event -> Inbox -> Activation -> Placement -> RunAttempt -> explicit Room command

Runtime transport plane
Generic process | ACP | vendor app-server | vendor SDK

Observation plane
typed runtime event/stdout/stderr -> bounded diagnostics/optional UI
```

- `rah-worker-process/v1` 是 L0 兼容层：只要求进程能调用 activation-scoped `rah worker`，不解析 Provider 输出决定业务结果。
- ACP、app-server、serve 和 SDK 是 L1 native adapter：拥有 session/prompt/steer/cancel/permission/model config，但不拥有 Room、Task、Inbox、Activation 或 Review。
- 一个 Provider 可以同时保留 legacy 与 native profile；升级必须新建 immutable RuntimeProfile revision，不静默改写历史 RunAttempt。

## 3. 当前真实结论

2026-08-28 的 opt-in config v4 gate 在一个 canonical Room 内同时启动：

| Agent    | CLI/model                              | 配置证据                                            | 结果                                                         |
| -------- | -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Codex    | `gpt-5.6-sol`, `low`                   | exact model binding + sandbox launch mapping        | 一个 Placement、一个 exit-0 RunAttempt、一个 canonical reply |
| Kimi     | `kimi-code/k3`, runtime default effort | exact model binding；prompt compatibility transport | 一个 Placement、一个 exit-0 RunAttempt、一个 canonical reply |
| OpenCode | `deepseek/deepseek-v4-flash`, `max`    | exact model/variant binding + `OPENCODE_PERMISSION` | 一个 Placement、一个 exit-0 RunAttempt、一个 canonical reply |

三条 lane 共用同一 Human Message，但各自只有一个回复；全部 Activation 完成。该 gate 不读取 stdout 判定成功。

2026-08-29 在四个内建 Runtime 均切换为 structured adapter 后再次运行同一真实 gate；Codex `gpt-5.6-sol/low`、Kimi `kimi-code/k3` 与 OpenCode `deepseek/deepseek-v4-flash/max` 在约 94 秒内重新通过。gate 使用临时 state/workspace、本机隔离 daemon 和 Raft 自动 resume-or-fresh，不再提交已删除的 per-Agent `sessionPolicy: fresh`；成功证据仍是三条独立 canonical Message、三条 completed Activation、精确 Placement 与 exit-0 RunAttempt，而不是 Provider stdout。

修复前，本机 Kimi `0.38.0` 因 `--prompt --yolo` 冲突连续 exit 1；固定 5 秒 retry 又形成启动风暴。当前修复为：

1. Kimi prompt compatibility profile 只诚实支持 `full_access`，不添加冲突 flag；`read_only/workspace_write` fail closed。
2. Local Workbench 与正式产品统一冻结 Raft-compatible `full_access`；这不是可覆盖的默认值。标准 RuntimeOffer 只发布该模式，Web 不显示权限档位，`workspace_write/read_only` 仅为旧 durable policy 的读取与迁移兼容，不能由新 client 重新写入。
3. Activation runtime failure 使用以配置值为基数的指数退避并封顶 5 分钟；同一失败不会固定频率无限撞击 Provider。

## 4. Native adapter 实施顺序

1. Kimi ACP：`kimi-acp/v1` 已完成 handshake、session/new/resume、model/config、permission、terminal、managed MCP capability filter、prompt、`session/cancel` 与 supervisor recovery。本机 Kimi `0.38.0` initialize 已确认 `sessionCapabilities.resume`；Host 私有 store 自动带入 opaque session ID。只有 ACP 严格 session-not-found 且未观察到工具副作用时单次 fresh，恢复期旧 transcript notification 不进入 trajectory，network/unknown error 不重试。取消先由 supervisor 只向 adapter leader 发 `SIGTERM`，driver 再发送无 request id 的 `session/cancel`、终止 client terminal，并等待原 `session/prompt` 返回 `stopReason=cancelled`；取消窗口内的新 permission request 必须回 `{outcome:{outcome:"cancelled"}}`，不得继续 auto-approve。宽限期后 supervisor 仍对整个 process group 发 `SIGKILL` 并要求 terminal proof。fake ACP 黑盒已证明该顺序、Provider child 未被提前 SIGTERM、取消的 session 不写 Host 私有 ready evidence。restricted mode 尚无可证明 sandbox，因此继续 fail closed。
2. Codex app-server：`codex-app-server/v1` 已进入 RuntimeProfile registry 和 Local Workbench。当前 Codex CLI `0.149.1` 的生成 schema与 fake app-server 黑盒共同证明 `initialize -> initialized -> thread/start|thread/resume -> turn/start -> turn/completed`、精确 model/effort、managed MCP `-c` 和 Raft 的 `approvalPolicy=never + danger-full-access`。标准产品不再暴露 `workspace-write/read-only` 或 Session 策略。Host 私有 store 自动执行 Raft 的 resume-or-fresh；missing rollout/thread 与 active writer 才可 fallback，permission/unknown terminal。approval policy 以当前 thread/turn 身份和 JSON-RPC ID 为 fence；外来身份、同 ID 不同内容 fail closed，完全相同重放不重复回应。filesystem/network 只回授 Provider 当前 turn 请求中的已知字段，未知字段丢弃且不写永久配置。取消先由 supervisor 只向 adapter leader 发 `SIGTERM`，driver 再按生成 schema 发送带精确 `threadId + turnId` 的 `turn/interrupt` 并等待 `turn/completed.status=interrupted`；取消窗口内 command/file approval 回 `decision=cancel`，无取消响应类型的 permissions request 以 JSON-RPC `-32800` fail closed，不再 auto-approve。被中止的 thread 不写 ready evidence，下一次仍 fresh；Provider 不退出时由有界 TERM/KILL 与外层全 process-group terminal proof 收口。fake app-server 黑盒已证明该顺序、Provider child 未被提前 SIGTERM；正式 Local Workbench 另证明 daemon 重启后恢复同一 thread。真实付费 Provider 取消/interrupt、watchdog 和 live input 尚未在本轮证明。
3. OpenCode serve：`opencode-server/v1` 已进入 RuntimeProfile registry 和 Local Workbench。driver 在 loopback 随机端口启动当前 CLI 的 `serve --pure`，先建立 SSE，再 `GET` 恢复或 `POST /session` 创建 Host 私有会话；model 使用拆分后的 `providerID/modelID`，effort 作为独立 `variant`，standing worker prompt 走每轮 `system` 字段。新会话固定写入 `permission=[{permission:"*",pattern:"*",action:"allow"}]`，同时保留 `OPENCODE_PERMISSION={"*":"allow"}` 的 launch fence；残余 `permission.asked` 自动回答 `always`，`question.asked` 自动拒绝并要求 Agent 经 RAH Worker 请求输入。完成必须同时有同步 assistant response 与当前 session 的 `session.idle`，只在该双重 terminal proof 后保存 opaque session ID。严格 GET 404 可在 prompt 前 fresh；已观察工具活动后不做恢复重试。取消先 POST 官方 `/abort`，被取消的 session 不写 ready evidence，外层 supervisor 才负责有界 TERM/KILL。fake HTTP/SSE 黑盒已证明 fresh→resume、404 recovery、model/variant/system、权限/问题处理、reasoning/tool/text trajectory、abort 顺序和 session ID 不泄漏；真实 mixed-CLI gate 已证明一次付费 turn 的精确 model/variant、canonical reply 与完成，真实 abort/watchdog 仍未证明。
4. Claude stream-json：`claude-stream-json/v1` 已进入 RuntimeProfile registry 与 Local Workbench。实现吸收 Raft `ClaudeDriver` 的双向 stream-json、resume、0600 standing prompt、model/effort、最高自治、managed MCP 和 bounded event normalization，并使用本机 Claude Code `2.1.234` 的 `--replay-user-messages` 将 exact activation prompt 回放升级为输入接受证据。missing session 只有在尚未接受输入且无工具活动时单次 fresh；取消由 driver 先向 Claude 发 `SIGINT`，取消轮次不保存 session，外层 supervisor 继续做全 process-group terminal proof。fake CLI 黑盒已证明 fresh→resume、missing recovery、model/effort/permission、thinking/tool/text、取消及 session/tool-output 不泄漏；Provider session 身份漂移、输入接受前工具活动、success frame 后异常退出都会终止且不写 ready evidence。`test:computer-sea` 另以构建后的自包含 macOS Computer 实际执行内嵌 Claude Driver，验证专用 fd3 上的 trajectory 与 Host-private session evidence 保持协议分离；真实付费 Claude turn 未在本轮自动执行。

退出条件不是“adapter 能启动”，而是同一 Room gate 另行证明：精确配置到达、输入只接受一次、取消有 terminal proof、resume 不重复旧 business action、一个 Provider 故障不阻塞其他 Agent。
