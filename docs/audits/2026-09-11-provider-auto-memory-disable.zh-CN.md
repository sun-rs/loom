# 受管 Provider 自动记忆关闭

用户本轮明确要求：RAH 启动 Provider 时关闭其自动记忆，不隔离 HOME，不修改宿主 CLI 配置和登录。

## 来源与差异

- Raft Computer 1.0.18，`raft-computer-1.0.18-recheck-20260909/main.js` SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，`prepareCliTransport`（738760 行）、Codex `buildThreadRequest`（758729 行）：继承宿主环境，没有统一禁用 Provider 自动记忆。本次是用户授权的隔离补强，不宣称 Raft 字节移植。
- Claude 官方 https://code.claude.com/docs/en/memory ：`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 为进程级开关。2026-09-11 查证。
- Codex 官方 https://developers.openai.com/codex/config-reference ：`memories.generate_memories=false` 不将新线程存为记忆生成输入；`memories.use_memories=false` 停止注入现有记忆。
- Multica `server/internal/daemon/execenv/codex_memory.go` 使用 feature、generate、use 三个开关；RAH 采用配置策略，改为 argv / thread config，不复制 managed config 文件写入机制。

## 单一 owner 与实现

`packages/agent-host` 的内置 Provider driver owns 启动覆盖。Claude 每个 fresh/resume/fallback child 显式覆盖该环境变量。Codex app-server 在用户配置参数之后附加三个 false 覆盖，并在 thread/start 与 thread/resume 的 config 中保留同样策略；model/effort 继续组合。

不修改 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR、认证、用户配置、Provider 会话持久化、RAH MEMORY.md/notes 或记忆 prompt。Kimi/OpenCode 本批未添加没有查证的禁用参数；自定义外部 Runtime 不宣称自动受此策略覆盖。

## 保证边界

关闭的是 Provider 自动记忆生成/注入，不是禁止普通文件工具访问记忆文件，也不是清除旧会话已包含的上下文。恢复旧线程保留原会话历史；此前已被存为记忆候选的历史不能据此宣称撤销，也不能约束另一独立宿主 CLI 进程。操作系统强隔离、删除宿主记忆与全插件禁用不在范围。

## 验证

- 先红后绿：现有 Claude/Codex 真实子进程 fixture 记录启动环境/argv/RPC，新增断言在修复前均失败。修复后覆盖新建、恢复、不可恢复回退和原生取消，两文件通过；不是付费模型测试。
- 安装的 Codex 0.154.0：非模型 config/read 握手实测返回 features.memories、memories.generate_memories、memories.use_memories 全 false。未创建线程、未开始 turn。
- 完整检查及正式重启结果在完成后追加。未运行付费模型，未声称真实模型隔离或 Raft 双边验收。

## 最终交付

完整 `npm run check` 退出 0：后端 1532 通过、17 跳过，Web 395 通过，其余合同/登记表/策略检查通过。首次完整检查曾出现一处测试目录清理 ENOTEMPTY（单独和最终全量复跑通过），以及旧 Codex argv 精确断言；后者已更新为新合同，并增测开启参数不能覆盖 RAH 的关闭策略。`npm run format:check`、`git diff --check` 通过。

冻结 1427 个源码文件摘要（`/tmp/rah-provider-memory-source-manifest.json`）并在部署前核对无漂移。正式重启闲置检查与备份验证通过，PID 99433 → 10822；备份 `/Users/sun/.rah/backups/pre-restart-eeb8295f-f96f-4d1e-a77f-3e58712e3cb9`。未改 Web，复用验证的冻结资产 `aff7b0d74d1fbecb3a56379d076a47770414e39f6ccf2bce164bc3b11deea248`。

重启后新建真实 Chrome 页面 `http://127.0.0.1:4173/?surface=tasks`，原有两条待确认任务及导航正常恢复。该检查证明页面与持久数据可用，不冒称模型记忆实验。未 commit/push，未运行付费模型。

交付末检期间并行 UI 工作新增 `docs/design/component-specs/sq-btn.zh-CN.md` 等未跟踪文件；全仓 format 检查因此对该外部新增文档报未格式化。本批文件的定向格式检查通过，保留并行修改，不能将先前全仓通过结果扩大到这些新增文件。
