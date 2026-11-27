# HOST-UNCONFINED-1：host 授权可显式免除 loom 外层 Seatbelt

现象（pilot-cell @a70ca693）：`daemon/host-worker.mjs` 的 `hostWriteBoundary` 只对 codex 免除 loom 外层 Seatbelt（L19-21）。agy host worker 运行 `sandbox-exec`（srt）时退出 71（嵌套 Seatbelt 不允许），`os.openpty()` EPERM，/tmp EPERM。cell 隔离实验需要 worker 自己启动 srt 和分配 PTY。

## 设计（Super 定）
- 默认行为不变：非 codex 的 host worker 仍有外层写入边界。
- `loom grant <task> host` 新增 `--unconfined`（只有 Super 能签；理由必填，沿用现有 grant 审计与计次）。带此标志的 grant 启动的 host worker，任何 CLI 都不包外层 Seatbelt。
- 回执/通知/状态页显示该 worker 为 unconfined，便于审计。
- codex 现有的免除逻辑保持不变（它需要自建 Seatbelt）。

## 要做
1. RED：agy/claude host worker 在 `--unconfined` grant 下 argv 不经 sandbox-exec；默认 grant 下仍经过。非 Super 签 `--unconfined` 被拒。
2. 实现 + 文档（docs 里 host 档一节补一句）。
3. 全量 `npm test`、`npm run lint` 通过（本机直接跑）。分支 infra/host-unconfined，工作树 /Users/sun/Code/repos/loom-host-unconfined，显式路径提交，不 commit -a。RESULT.md 以 STATUS 行收尾。不 push，不改 main。
所有 CLI 用绝对路径，不改全局配置，不读凭据。

## 追加（Super，用户裁决）
srt 内的 CLI 一律完全访问模式（关闭自带沙箱与审批）。本卡只负责"去掉 loom 外层 Seatbelt"；在 RESULT.md 里列出四家 CLI 当前 host 档启动参数中自带沙箱/审批的开关状态，供后续 cell 启动器统一设为完全访问。
