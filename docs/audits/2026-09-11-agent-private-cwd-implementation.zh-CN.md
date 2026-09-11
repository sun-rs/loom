# Agent 私有默认 cwd：本地实现与验证边界

状态：本地实现与针对性自动验证完成，待主任务独立审查、全仓检查和正式部署。未运行付费 CLI、浏览器或 Raft 双边验收，未提交、推送、重启正式服务。当前工作树混有主任务投递/UI 改动，不能用 HEAD 代表本批源码。

## 上游事实与本地适配

来源为授权 Raft Computer SEA 1.0.18 发布物，官方稳定 manifest `https://cdn.raft.build/computer/manifest.json`；不是 npm 同名版本，版本身份见[重新提取记录](./2026-09-09-raft-upstream-prompt-tool-refresh.zh-CN.md)。已有本地提取物 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js` SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。未复制整个发布 bundle 或改写其许可证。代码复用分类为行为结构移植与 RAH glue，不是 byte-exact 复制。

Raft `main.js:765082` 由 `join(this.dataDir, agentId)` 得到 Agent 目录，765083 初始化，765146 传给版本启动检查，765316–765337 作为 `runtimeContext.workingDirectory` 交给 driver session。该事实支持独立默认 cwd，而不支持“没有 workspace lock，所以多 Agent 默认共享 checkout 等价”的旧注释。已纠正 Kernel 与 config 的注释，不修改已有全局 sharing 选择。

Multica 二次对照仅验证已有 `server/pkg/agent/codex.go:1825,1883` 将 `opts.Cwd` 传入 provider 请求，不将其用作默认目录语义证据。具体来源限制见[原方案](./2026-09-11-agent-private-cwd-plan.zh-CN.md)。

Raft `resetWorkspace` 在 766734 附近递归删除 agentDataDir。RAH 不照此删除旧项目目录；下述隔离、收据与恢复规则是保留本地已有安全约束，不宣称来自 Raft 的持久事务实现。

## 已实施

- Agent 定义 optional `executionWorkspace` 无 schema 默认值。支持能力的本地 Host 上新建写入 `agent_private`；既有缺字段定义继续 legacy mount。显式 `existing_mount` 必须匹配 Host 已授权的非私有 descriptor；configure 保留字段。fresh bootstrap 同样显式创建私有 Agent，旧 bootstrap 状态不迁移。
- 本地 daemon 通过可信 composition 发布 `supportsAgentPrivateWorkspace`。私有 Agent 只匹配本人 mount 且 Offer 必须支持。独立 Computer 的 Worker 文件与证据根尚未完整接通，因此不发布能力；显式私有创建拒绝，不能静默退回全局 cwd。此限制经过主任务确认，不扩建远程文件 API。
- Host 认证快照只返回已授权、未删除 Agent 的定义与目录意图，不含 Host 路径。上限 512 为完整快照边界，超过即拒绝，不能取前 512 个使其他 Agent 静默消失。旧心跳不含字段保持兼容。
- AgentHost Catalog 按 participant 身份物化 `stateDirectory/agent-workspaces/` 下目录，验证安全路径与 symlink，持久保存 mount receipt。单 Agent 准备失败隔离，不使其他 Agent 整体失效；未准备私有目录无 legacy fallback。路径是同一用户权限下的 cwd 隔离，不是沙箱。
- 实际 runtime cwd、Worker 文件根、memory preparation executionCwd、prompt workspacePath 消费同一选择。持久 RuntimeProcess descriptor 包含冻结 mount 身份，Kernel 对照原 Placement 验证，恢复按冻结 receipt 解析。已有进程不随当前定义或新默认换目录。
- 文件浏览 runtime-project 根按 owner 动态解析；未解析时不回退到全局目录。私有记忆位置和 owner 不变，不迁移、归并或自动改写 MEMORY.md/notes。
- full reset 将本 Agent 私有执行目录与既有 memory reset 组合，复用 Kernel 执行围栏。pending 先持久后 rename，未完成状态在重启后禁止重建、发布与浏览该目录。完成决定以既有 reset coordinator receipt 为准；发布后 finalize 失败不能回滚已提交决定。重开读取权威收据，重放 finalize 并释放原操作围栏。历史 op1 重放不会解除较新 op2 的 pending 围栏。legacy full reset 不删除项目 cwd。
- 启动时 AgentHost 等待 async `afterOnline` 完成再执行；否则异步 mount 发布可越过关闭过程访问已关闭数据库。该竞态已用真实延迟 barrier 测试复现并修复。

## 自动验证

全部使用临时状态和 Fake CLI，无真实模型消耗。

本批最终针对性命令为 `node --test --test-concurrency=1` 加以下 20 个文件，158 通过，0 失败，日志 `/tmp/rah-private-targeted-final.log`：

```text
packages/kernel/test/private-workspace-placement.test.ts
packages/kernel/test/private-workspace-provisioning.test.ts
packages/kernel/test/placement-planner.test.ts
packages/kernel/test/durable-placement.test.ts
packages/kernel/test/execution-workspace-binding-auth.test.ts
packages/agent-host/test/agent-execution-workspace.test.ts
packages/agent-host/test/agent-execution-workspace-catalog.test.ts
packages/agent-host/test/agent-runtime-workspace-roots.test.ts
packages/agent-host/test/agent-execution-workspace-reset.test.ts
packages/agent-host/test/agent-execution-reset-coordinator.test.ts
packages/agent-host/test/runtime-execution-workspace.test.ts
packages/agent-host/test/agent-host-daemon.test.ts
packages/agent-host/test/remote-runtime-profile-composition.test.ts
packages/agent-host/test/computer-resident-service.test.ts
packages/daemon/test/private-workspace-composition.test.ts
packages/daemon/test/private-workspace-reset-recovery.test.ts
packages/daemon/test/local-workbench-bootstrap.test.ts
packages/daemon/test/daemon-application.test.ts
packages/application-service/test/computer-application-service.test.ts
packages/computer-protocol/test/execution-workspace-bindings.test.ts
```

`npx tsc --noEmit` 通过，日志 `/tmp/rah-private-typecheck-final.log`。此项不是 Web typecheck 或全仓 check。

关键反证日志包括 `/tmp/rah-private-placement-red.log`、`rah-private-binding-red.log`、`rah-private-heartbeat-red.log`、`rah-private-recovery-red.log`、`rah-private-provision-red.log`、`rah-private-bootstrap-red.log`、`rah-private-online-red.log`、`rah-private-reset-decision-red.log`（均位于 /tmp）。将实际 spawn cwd 暂时回退 global 后，`/tmp/rah-private-spawn-red.log` 因私有目录没有子进程写入文件而失败；恢复接线后同一测试通过，见 `rah-private-spawn-green.log`。

验证覆盖两个 Agent 同名相对文件不覆盖，真实 Fake 子进程 cwd 文件，Human 创建后无需重启发布 mount，原进程冻结 descriptor，重启路径保持，旧项目保留，坏路径/权限/Host 认证/错误 mount 拒绝，局部 prepare 失败，reset 失败与重放。reset 重启测试使用真实 Kernel、Host generation、Catalog 与 daemon factory，仅时间和 Provider 连续性以可控替身注入。

## 仍不能宣称完成的部分

- 全仓 `npm run check` / `npm run format:check`、正式构建备份重启、真实浏览器与真实模型跨 Room/DM 验证由主任务执行；本批不宣称已经部署或完成 Raft 双边验收。
- 新私有默认仅支持本地一体 daemon；旧/独立 Computer 不具备该能力。未添加任意路径选择 UI、跨机器文件浏览或证据读取。
- 隔离目录保留；自动 retention/GC 未接入。pending 且无权威完成收据保持阻断，不猜测重置是否完成；不宣称所有断电窗口都自动恢复。
- 既有共享目录不迁移。显式共享项目仍可能并发写同一文件，私有 cwd 不约束绝对路径访问。
- frozen receipt 是路径与身份凭据，不是工作区内容快照或测试结果冻结；不等于 Submission 证据不可变验收。

## 独立主审后的规模门禁修正

主任务全仓检查发现 RoomKernel 与 DaemonApplication 超出既有行数上限。本次纯提取 `placement-candidate-projection.ts`（原候选 SQL、排序、decoder 回调及 optional 字段不变）和 `daemon-execution-workspace-composition.ts`（原 Catalog、refresh、reset-replay/Offer lifecycle、mount 与冻结 cwd 接线）。事务、持久状态、memory/reset coordinator 创建及 cleanup 时机仍由原 owner 持有。

RoomKernel 6916/6925，DaemonApplication 798/800；未提高上限、未压缩格式。提取后 8 文件针对性回归 74/74，通过 `npx tsc --noEmit`、这 5 个源码/owner 文档的 Prettier check 与 `git diff --check`。日志 `/tmp/rah-private-extraction-tests-final.log`、`/tmp/rah-private-extraction-typecheck.log`、`/tmp/rah-private-boundary-green.log`。8 文件为 core/daemon source-boundary、kernel private-workspace-placement/private-workspace-provisioning/durable-placement、daemon private-workspace-composition/private-workspace-reset-recovery/daemon-application。

主任务完整门禁重跑及部署仍待其签收，本节不替代全仓结果。

## 主任务联合验收更新

本批冻结后已由主任务完成独立代码复核、全仓检查、正式构建、备份重启和正式页面验证；先前“待主任务验收/部署”状态已更新。详见[第二批联合交付](./2026-09-11-parity-batch-review-and-delivery.zh-CN.md#第二批联合交付主任务验收完成)。真实CLI与Raft双边模型实验仍未执行，其余语义限制保留。
