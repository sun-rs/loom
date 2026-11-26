# 交叉核验

120. 查继任首报和事实卡的原件。逐项核对 HEAD、分支、基线、WIP 与裁决，再运行 `"$LOOM_BIN" rotation-policy verify --target "$ADDR" --verdict pass|fail --detail "$DETAIL" --evidence "$FILE[:LINE]"`。
