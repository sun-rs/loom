# 门禁退回

170. 先读退回回执原件。用 `loom send "$WORKER" --expect-reply "REJECT $FIX_AND_RECEIPT_PATH"` 把可复现的修复点、验收及原件路径交回原卡。纯局部返工保持原会话。
171. 改方向、R3、造假或越权时新开 Worker，卡内附可复现的 RED 和待守的验收不变量。
172. 发出后首行单独写 `DONE`，第二行写「已退回 <卡>」，结束本轮等原 Worker 回执。
