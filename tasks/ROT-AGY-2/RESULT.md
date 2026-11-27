# ROT-AGY-2 结果

## 根因和证据

- 只读回放 pilot-cell 继任会话 `loom-e6aaf773-24ff-431f-afd2-582279c4f8bc` 的 holder 日志（`pty-Gi2J8U/events-0000000000000000`、`requests.jsonl`、`write-19bf27a6a51e4f9096253fd625fd277d`）及 `notifications.json` 证实：
  - 继任会话启用了 `accountStatusline`（无 `userCommand` 时输出空 stdout）。本机实测 `/Users/sun/.local/bin/agy` 1.5.18 在空输出 `statusLine` 下会省略下边框之后的全部内置页脚（既无 `? for shortcuts`，也无 `accept-edits · ...`），在粘贴前后均如此。
  - 首投 `f4d7282b-689d-40ca-836a-445b523b4add` 已通过 ROT-AGY-1 的欢迎屏判定（`seq=9` 时 `agyStartupComposer=true`、`draft=""`），并由 holder 完整写入 418/418 字节 bracketed paste（`seq=11`，`partial=false`）。
  - agy 重绘出 3 行交接草稿（`seq=12..13`）后，`verifyAgyDraft` 校验通过，但 `submitAgyComposer` 调用 `verify(..., { held: true })` → `heldComposer(frame)` 返回 `false`：空页脚使 `classify(vacantText)` 为 `unknown`，且 `hasHeldComposer(vacantText)` 强依赖 `accept-edits · ...` 模型页脚。于是 `requests.jsonl` 记下 `hostReceipt: { accepted: false, outcome: "composer-blocked-during-paste" }`，未发 Enter。
  - 此后 `observe()` 见到未提交草稿报 `blocker = 'draft-held'`（120 秒后触发 `delivery-stalled draft-held`，13 分钟后 `self-rotation-overdue` 回收终端）。即使 `provePaste` 证明 `complete`（418/418，`ownsDraft=true`、`closedBracket=true`），`recoverStartup` 也同样卡在 `heldComposer(frame) === false`，无法认领发送 Enter。
- 同时排查 agy 输入框与提示识别发现三类脆弱假设：
  1. `tui/pty-grid.mjs` 对输入框占位符硬编码固定模式文案后缀（`agySuggestion`），未知文案或 dim（`\x1b[2m`）占位符会被误判为草稿；折行上边框或缺少下边框的半帧重绘也会干扰识别。
  2. `adapters/agy/screen.mjs` 未对 `hasEmptyComposer`/`hasHeldComposer` 剥离 `⚠ Sign-in update needed` 提示块及折行续行，也未将底栏 `Tip: …`（尤其正文含 `esc`/`enter`/`cancel`/`confirm` 时）视为非交互提示。
  3. `tui/providers.mjs` 的 `agyScreen` 预处理在进入 `hasEmptyComposer` 前剥离了两段式模型页脚，无法区分「内置页脚隐藏了快捷键」与「空 `statusLine` 本身无页脚」。

## 修复和验证

- **最小假设画面与草稿识别**（`adapters/agy/screen.mjs`、`tui/pty-grid.mjs`、`tui/providers.mjs`、`tui/holder-terminal.mjs`）：
  - 在 `pty-grid.mjs` 中基于常规缓冲区下的光标起始位置 + 全可见字符弱化样式（`dim`、ANSI 亮黑 `fg=8`、256 色灰阶 `238..250`、中性灰 RGB）识别 agy 占位提示，不绑定固定 agy 版本文案；用户真实输入的默认前景色文本、`/help` 高亮命令或移动光标后的草稿仍严格判为草稿。处理折行上下边框与缺下边框的半帧重绘。
  - 在 `adapters/agy/screen.mjs` 中统一 `inspectComposer`：剥离 `⚠ Sign-in update needed` 软警告块（保留 `signInWarning` 上报），将 `Tip: …` 识别为被动提示，支持空 `statusLine` 页脚与 2/3 段及窄屏模式页脚，同时继续拦截仅模型页脚的空框判定、交互提示、旋转进度符、后台任务、设置错误及所有弹窗/报错状态。
  - 未知占位提示与未知非交互底栏默认不判为草稿/阻塞，通过 `unknownHints` 经 `bindTuiSession`（`tui/index.mjs` → `daemon/tui-holder.mjs` → `daemon/sessions.mjs` 的 `report`，独立运行默认 stderr）按会话去重记日志一次。
- **真实字节夹具与 RED → GREEN**：
  - 使用脱敏的真实 `agy 1.5.18` 字节流（`pty-Gi2J8U` 欢迎/粘贴/异步头更新帧，以及本机临时目录启动 `/Users/sun/.local/bin/agy` 抓屏得到的空 `statusLine`、`Tip:` 底栏、50 列窄屏与真实手打草稿帧；无登录操作、无模型请求、未改全局配置、未读凭据）制作夹具 `tasks/ROT-AGY-2/agy-startup-frames.json`。
  - RED（`/tmp/loom-rot-agy-2-red.log`）：5 项新增回归全部失败，其中 `pty-Gi2J8U` 端到端用例在基线上精确复现 `f4d7282b` 的 `reason: "draft-held"`，holder 认领用例复现 0 次 Enter。
  - GREEN（`/tmp/loom-rot-agy-2-green.log`）：上述 5 项新增回归全部通过。
- **全量验证**：
  - `npm run lint` 通过（332 files）。
  - `npm test -- --test-concurrency=4` 全量 **894/894** 通过（fail 0、cancelled 0、skipped 0，无多余 `loom-tui:` 日志噪音；完整日志 `/tmp/loom-rot-agy-2-full.log`）。
  - `git diff --check` 通过。

STATUS: done
