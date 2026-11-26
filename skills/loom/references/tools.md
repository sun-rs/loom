# 工具例外

1. 核实拒绝
2. 重试与回执

## 核实拒绝

从 `loom status` 或 `loom hist` 核对拒绝与 Worker 可用性。

## 重试与回执

确有必要时运行 `"$LOOM_BIN" senior-tool --reason "$WHY" -- "$ORIGINAL_COMMAND"`。loomd 已确认 Worker 或投递故障时可省理由。用返回的末尾证据定位下一步。
