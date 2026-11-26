# 工具例外

1. 核实拒绝
2. 重试与回执

## 核实拒绝

从 `loom status` 或 `loom hist` 核对拒绝与 Worker 可用性。`loom hist "$ADDR" --before N` 或 `--page N` 翻早期轮次，`--all` 读全部 L1 摘要。

## 重试与回执

确有必要时复制拒绝回执的 `"$LOOM_BIN" senior-tool --retry DENY-ID --reason "具体理由"`，用一句话说明原因。loomd 已确认 Worker 或投递故障时可省理由，回执标记 `worker-unavailable`。输出保留最后 40 行。
