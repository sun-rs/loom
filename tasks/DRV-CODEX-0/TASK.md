# DRV-CODEX-0：Codex app-server 薄驱动

## 目标
在 `/Users/sun/Code/repos/loom_new/drivers/codex-appserver/` 下，写一个**尽可能薄**的 Codex app-server 驱动。这是"驱动层"：只讲 Codex 的原生语言，不依赖 loom 协议（协议由 PROTO-0 并行编写，你不要等它，也不要实现它）。

驱动需要能做到：
1. 连接 app-server。优先连常驻 daemon（`codex app-server daemon` / `proxy`，即 control socket），stdio 作为备选。驱动自己**不能**成为 Codex 进程的唯一宿主：驱动进程重启后，必须能重新连上，并通过 `thread/resume` 或等价方法接回原来的 thread。
2. initialize；thread 的 start / resume / list；turn 的 start / steer / interrupt。
3. 以 async iterator 或回调的形式产出**原生**通知事件，至少包括 turn 开始和完成、item 开始和完成（含 commandExecution 的命令、exitCode、输出，以及文件改动）、错误、token usage。
4. 断线检测；重连后告诉调用方"可能漏掉了哪些"。如果 app-server 提供历史或 turn 读取方法（例如 `thread/read`、`thread/turns/list` 之类，以生成的类型为准），就提供"按 turn 补读"的函数。

## 薄封装硬约束
- **零运行时依赖。** 只用 Node 25 内置能力（`node:net`、`node:child_process`、`node:readline`、`node:test`）。Node 25 可以直接运行 `.ts`（type stripping），所以不需要编译步骤，也不需要 Effect、zod 或任何框架。
- 类型**只用官方生成的**：`codex app-server generate-ts --out drivers/codex-appserver/generated/`（不调用模型）。记录生成时的 codex 版本（`codex --version`，当前是 0.171.0）。不要手抄 T3 或 OAR 的 schema。
- 手写代码目标 ≤ 500 行（不含 generated 和 tests）。如果超出，在 RESULT 里说明原因。
- 不做业务逻辑：不做重试策略、模型选择、prompt 注入或最终输出格式化。

## 参考（只读，借鉴边界情况处理，不整包依赖）
- T3：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/t3code/packages/effect-codex-app-server/src/`（`protocol.ts` 是 JSON-RPC 帧和请求响应路由；`client.ts`；`replay.ts` 和 fixtures 可以拿来当测试数据，MIT，复制时在文件头注明来源）、`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`
- OAR：`.../repos/oar/packages/oar/src/runtimes/codex/`（steer、interrupt、压缩归属、后台进程、版本下限这些边界情况）
- Orca：`.../repos/orca/` 中的 codex shared server pool（搜 `codex-shared-server-pool`）
- 已有实测：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-2b/codex/RESULT.md`（app-server daemon 和 `--remote` 的实测结论，先读）
- rah_os `packages/agent-host/src/codex-warm-adapter.ts` 只作为经验参考，不搬代码

## 测试
- `node --test`：用 fixtures 回放（T3 的 replay fixtures，或你自己从生成类型构造的序列），覆盖正常 turn、带 commandExecution 的 turn、interrupt、错误、断线重连。
- 允许的不调用模型的实机探针：`codex app-server --help` 及其子命令的 help；`generate-ts`；启动 app-server 或 daemon 后只做 initialize / thread/list / thread/start，**不要 turn/start**，因为那会调用模型。daemon 用完要停掉，记录你启动和停止了什么。
- 如果 daemon 需要登录态，可以使用本机已有的 codex 登录（由 codex 自己读取），但你不能读取或打印 `~/.codex/auth.json`。

## 交付
- `drivers/codex-appserver/`：`src/`、`generated/`、`test/`、`README.md`（用法，以及哪些能力已实测、哪些只是源码推断）
- `tasks/DRV-CODEX-0/RESULT.md`：完成内容、手写行数、实测结果、未决问题（特别是：断线期间的事件能否补齐，需要付费 turn 才能验证的点）；最后一行写 `STATUS: done`

## 红线
- 只能在 `drivers/codex-appserver/` 和 `tasks/DRV-CODEX-0/` 内写文件。**不要 git commit**，同一仓库里还有其他 worker 并行工作，提交由 orchestrator 统一做。
- 不读、不打印、不复制凭据（`~/.codex/auth.json`、`~/.codex/memories*`、`.env`、任何 token）；不读用户真实的会话记录（`~/.codex/sessions`）。
- 不调用付费模型（不发 turn/start），不安装软件，不使用 `hc send`/`hc keys`/`hc kill`，不 push，不修改 loom_new 以外的任何目录。
- 不设置或伪造 `CLAUDE_CODE_ENTRYPOINT`，不伪造 clientInfo，不读写 OAuth token。clientInfo 使用 `loom_new`。
