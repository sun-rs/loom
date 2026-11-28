# 集成门禁

140. 核对集成卡、固定候选及全量原件，用 `"$LOOM_BIN" gate pack "$GATE" --round "$ROUND" --project "$PROJECT" --base "$BASE" --candidate "$CANDIDATE"` 交付。重取原包加 `--reuse`。
141. 审核与授权齐备后发给原集成 Worker 合入。v2 保护分支在移动 ref 前运行 `"$LOOM_BIN" notifications --gate-complete "$GATE" --candidate "$CANDIDATE"`。合入完成后用 `loom notifications --gate-complete "$GATE"` 登记边界。
