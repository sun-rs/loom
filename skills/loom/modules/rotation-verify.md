# 交叉核验

120. v2 启动前，用命令核对交接单的 SHA、路径和在途项，按投递所列目标与 ID 运行 `rotation-policy verify-note`。
121. 核验首报时逐项核对 HEAD、分支、基线、WIP 与裁决原件，运行 `"$LOOM_BIN" rotation-policy verify --target "$ADDR" --verdict pass|fail --detail "$DETAIL" --evidence "$FILE[:LINE]"`。
122. 收到首个完整阶段的决定核对时，查派工、门禁或审计原件，按投递的 ID 运行 `rotation-policy verify-decision`。窗口内暂缓另一方常规换班。
