# ADAPT-agy：从 Orca 抽取 agy 的 TUI 适配层

## 背景
loom_new 路线：hc 持有 PTY，所有 CLI 以原生 TUI 运行；leader/auditor/worker 都通过 `loom spawn` 拉起（不再手敲官方命令）；薄 loomd 负责最终回复搬运、会话索引、历史查询、卡死检测。不做 app-server/headless 第二体系。
用户已获得 Orca 代码的完全复制许可：**优先复制 Orca 现成代码**（保留来源注释：文件路径+commit），只写胶水；T3 仅作参考。

## 源码
- Orca（固定 commit b7fd7caa3）：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/orca/ （重点 src/main/agy*、src/main/agent-hooks、src/main/claude/hooks、src/main/antigravity、状态识别/信任框/输入投递相关代码；用 rg 定位）。可联网对比 GitHub 最新版，若关键文件有变化在 RESULT 中注明。
- T3：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/t3code/（参考）。
- loom_new 现有零件：drivers/tui-hooks/、drivers/claude-tui/、relay/（hooks.mjs、sources.mjs）、/Users/sun/Code/exp-relay/orca/lib/（实验产出的 loom-transcript 解析与屏幕识别，隐藏验收 37/37，可直接搬入）。

## 交付：`adapters/agy/`（Node ESM，零依赖，可从 Orca 的 TS 转写为 JS 或保留 TS+node --experimental-strip-types，择一并在 README 说明）
导出一个适配器对象，接口（暂定，PROTO-1 会定稿，保持字段名）：
- `id`、`capabilities`：`{ steer: 'native'|'tui-queue'|'none', interrupt: bool, resumeSamePane: bool, hookInjection: 'cli-flag'|'settings-arg'|'project-file' }`（必须实测得出）
- `launch({ model, effort, cwd, prompt, hookSink, extraArgs })` → `{ argv, env }`：免审批/无选择器模式；hook 用按次注入，不改全局配置、不在项目目录落会触发信任框的配置
- `screen.classify(text)` → `idle|busy|trust-dialog|picker|rate-limit|auth-fail|unknown`；`screen.dialogKeys(kind)` → 处理已知弹窗的按键序列（如 Claude 信任框需 down enter）
- `hooks.normalize(payload)` → `{ type: 'turn-start'|'turn-end'|'tool'|'stop-failure', sessionId, transcriptPath, finalReply? }`
- `transcript.locate({ sessionId, cwd })`、`transcript.parse(text)` → loom-transcript Session 结构；`transcript.turnSummary(session, n)` → 每轮 ≤400 token 的 L1 摘要（做了什么、工具调用计数、非零退出命令、最终回复首段）
- `input.plan(mode)`，mode ∈ `queue|steer|interrupt` → 按键/文本发送计划；不支持 steer 时降级为 queue 并标明

## 实测（必须）
在 /Users/sun/Code/exp-relay/adapt-agy/ 用 hc 拉起真实 agy（小模型/低档位，无害提示词），验证：启动与信任框处理、turn-end hook 拿到最终回复、busy 时发送文本的实际行为（插入当前轮 / 排队到轮末 / 丢失）、Esc/Ctrl-C 中断后原窗格续作。结果写进 capabilities 和 RESULT。完毕 `hc kill` 自己的终端。

## 测试
`node --test adapters/agy` 全绿（用 Orca/实验的样本与实测采集的脱敏样本）。

## 红线
- 不复制 Orca 的 OAuth token 读取/刷新/覆写、账号凭据处理、agy clientInfo 'zed' 伪装；不复制 T3 的托管 Codex token broker。不设置或伪造 CLAUDE_CODE_ENTRYPOINT。
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己实测目录产生的会话记录。
- 只写 adapters/agy/、tasks/ADAPT-agy/、/Users/sun/Code/exp-relay/adapt-agy/；不改全局 CLI 配置；不 commit；只操作自己创建的 hc 终端；不碰 Solars、t17*、CCP。
- 完成写 tasks/ADAPT-agy/RESULT.md（中文：复制了哪些 Orca 文件及行数、自写胶水行数、能力实测表、遗留问题），最后一行 STATUS: done。
