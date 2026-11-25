# PROTO-2：以 OAR 契约为 loom 协议的底座（设计文档，不改代码）

## 用户决定与背景
- 底层 worker 统一用 OAR（@botiverse/oar，Apache-2.0）：Codex=app-server、agy=ACP、OpenCode=ACP。
- Claude 一律 TUI（hc 持有 PTY），不走无头；不设置/伪造 CLAUDE_CODE_ENTRYPOINT。
- 目标：上下两层同一套词汇。OAR 支持自建 Runtime：`createRuntimeRegistry(runtimes)`（packages/oar/src/registry.ts），契约在 packages/oar/src/contracts/（runtime.ts 等）。设想：把 "claude-tui"（hc + adapters/claude）实现成符合 OAR Runtime 契约的自定义 runtime，loom 只面向 OAR API。
- OAR 源码（只读）：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar（docs/spec/runtime-matrix.md、docs/runtimes/*.md、packages/oar/src/contracts、community/ 下的社区 runtime 示例 cybion/morph）。
- loom_new 现状：docs/PROTOCOL.md（PROTO-1 收窄版）、schema/protocol.ts、adapters/{claude,agy,codex}、relay/；OAR-INTEG-0 正在 runtimes/oar/ 接入 OAR（勿改）。

## 要回答并写成 docs/PROTOCOL-v2.md（中文）
1. OAR 契约梳理：Runtime/Session/record stream/capabilities/turn outcome（completed/interrupted/quota/rate_limited…）/history/resume/interrupt/steer 的类型与语义，附文件:行号。
2. 可行性：自建 "claude-tui" runtime 需要实现契约的哪些方法；hc + adapters/claude 能满足哪些、哪些只能声明为不支持（capabilities）；估计代码量；社区 runtime 示例是否证明外部实现可行。
3. loom 协议 v2 = OAR 契约 + loom 编排层：loom 自己只保留什么（项目/角色/任务/波次的会话索引、最终回复按波搬运、空闲投递收件箱 queue/steer/interrupt、`loom spawn/send/hist/state/ls/stop` 命令面）；每个命令如何映射到 OAR API。
4. 与 PROTOCOL.md（v1）的差异表：哪些删、哪些改名对齐 OAR、哪些保留。
5. 风险：OAR 版本演进（锁版本 vs 跟最新）、契约变更的监视清单、OAR 不覆盖时的退路。
6. GUI 预留：基于 OAR record stream + hc 终端流的统一界面需要哪些数据接口（只列接口，不设计 UI）。
最后一行 STATUS: done；tasks/PROTO-2/RESULT.md 写 10 行内摘要。

## 红线
只写 docs/PROTOCOL-v2.md 与 tasks/PROTO-2/；不改代码、不 commit；不读凭据和会话记录；不使用 hc send/keys/kill；不运行任何 CLI。
