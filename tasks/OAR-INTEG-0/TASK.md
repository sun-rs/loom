# OAR-INTEG-0：以 OAR 为无头 worker 运行时 + TUI 对无头对照测试

## 背景
路线：loomd 为中心；两个运行后端——hc（TUI：super/leader/auditor、人工接手）与 OAR（无头 worker）。用户不愿维护多家 CLI 解析层，所以无头层**依赖 OAR 而不是复制它**。
OAR 源码（只读参考，commit ed8e1a2）：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar（README、docs/runtimes/{codex,antigravity,claude}.md、packages/oar）。Apache-2.0。先确认 npm 上是否有发布包（@botiverse/oar）及版本；没有则在 loom_new/vendor/oar 以 git 子目录方式引入并构建（项目内依赖，可以安装；不装全局软件）。
loom_new 相关：docs/PROTOCOL.md（PROTO-1 可能正在改写，以其接口为准）、relay/、adapters/（ADAPT 卡并行进行中，勿改）。

## 交付 1：`runtimes/oar/`（薄胶水）
- `spawnHeadless({ cli: 'codex'|'agy', model, effort, cwd, prompt, project, task, wave })`：通过 OAR 开 Session、发首轮；免审批、无选择器。
- 把 OAR 事件映射为协议事件：turn-start、turn-end（含原生最终回复）、stuck/quota（OAR 的 quota/rate_limited 结果）、usage。
- 写会话索引记录（字段见 PROTOCOL.md：role/project/task/wave/cli/model/sessionId/transcriptPath/cwd/startedAt/endedAt…），确认原生会话记录（Codex rollout、agy transcript）照常落盘、路径可得，以便 `loom hist`。
- 与 relay 衔接：turn-end 时把最终回复交给 relay 的同一投递路径（按波合并后 hc send 给 leader）。可在 relay 中加一个 OAR 事件来源，保持改动最小。
- 续作：同一 Session 再发一轮；中断：OAR 的 interrupt。人工接手说明：如何用 `codex resume <id>` 在 TUI 打开同一会话（实测一次）。
- 胶水代码目标 ≤300 行；测试 `node --test runtimes/oar`。

## 交付 2：对照测试（必须实测）
任务：/Users/sun/Code/exp-relay/seed 的 T1（Codex 会话解析，codex gpt-6.2-sol high）与 T3（agy 会话解析，agy）。每个 CLI × {TUI via hc, 无头 via OAR} × 2 次，独立目录 /Users/sun/Code/exp-relay/mode-bench/<cli>-<mode>-<n>/（由 seed 复制）。相同提示词（任务卡内容 + "完成后最终回复首行 DONE T1"）。
测量：模型调用数、新鲜输入、缓存读、输出、总量（读本次目录对应的原生会话记录；可复用 /Users/sun/Code/exp-relay/tokens.py 的解析逻辑）、墙钟、隐藏验收 `DIR=<dir> node --test ~/.exp-graders/exp-relay/accept.test.mjs` 中对应任务的通过项。
结果表写进 RESULT，并给结论：无头相对 TUI 的 token 与耗时差异（注明 n=2 的局限）。

## 红线
- 不使用 OAR 读取/刷新/写入凭据或账号 token 的功能；不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）。不设置或伪造 CLAUDE_CODE_ENTRYPOINT。本卡不跑 Claude 无头。
- 只读本卡测试目录产生的会话记录。只写 runtimes/oar/、vendor/oar/（如需要）、relay/（最小改动并保持原测试通过）、tasks/OAR-INTEG-0/、/Users/sun/Code/exp-relay/mode-bench/；不改全局 CLI 配置；不 commit。
- 只操作自己创建的 hc 终端；不碰 Solars、t17*、CCP 及其他 worker 终端。
- 完成写 tasks/OAR-INTEG-0/RESULT.md（中文），最后一行 STATUS: done。
