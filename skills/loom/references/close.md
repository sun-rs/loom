# 收尾

1. 通知
2. 草稿
3. 关停

## 通知

先保存阶段报告再发通知。暂挂时先把已保存 ID 写回同一报告，路线恢复后以原参数重试。

## 草稿

关闭会话后使用 `git diff --cached` 和 `git diff`。用 `git ls-files --others --exclude-standard` 找授权内草稿，保存可恢复补丁并把路径写回报告。

## 关停

用 `loom stop "$ADDR" --project "$PROJECT"` 关闭归属会话。最后用 `loom doctor --project "$PROJECT"` 查残留。
