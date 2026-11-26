# 换班

101. 到安全边界再换。路径未给或 v2 时先运行 `"$LOOM_BIN" rotate --self --prepare`。
102. 写判断、未决事项、在途卡 ID、已完成证据、首个动作。v2 用以下标题，每节填正文（无则写「无」）：
- `## Status` 录 Branch:、Base SHA:、WIP:，目标及在途卡。
- `## Case ledger` 生效裁决编号、原件、缘由及边界。
- `## Rejected options and reasons` 否决和理由。
- `## Unresolved items` 未决与责任人。
- `## User preferences and trust` 偏好及可信度证据。
- `## Next action` 动作、触发条件与解阻人。
- `## Do now` 可选，逐条列应继续的工作及卡、门禁或路径。
- `## Rerouted messages` 在途 ID 及处置建议。
103. 运行 `"$LOOM_BIN" rotate --self` 后用一句话报告判断路径和调度结果，结束本轮。v2 核验期间前任只读，失败则恢复前任并暂停本阶段换班。旧模式首次失败按原因修正并重试一次。
<!-- ROT-TUNE-2: INTEG-3 合入后在此接续结构化换班动作。 -->
