# Super 运维

1. Host 授权与账号
2. 换班例外
3. 发布与排障

## Host 授权与账号

核对卡面命令、可写路径和额度。用 `loom grant "$TASK" host --reason "$WHY" --uses "$N"`，获准外写逐条加 `--write PATH`，按需加 `--ttl`。具名波可在 `roles.worker.tiers` 预授权 host。用 `loom accounts` 看快照，获准实时核对才用 `--refresh`。

## 换班例外

对现任目标用 `loom rotate --target leader|auditor`，需要时加 `--prepare` 或获准的 `--cli`、`--model`、`--effort`。v2 阶段锁由 loomd 判定。

## 发布与排障

先跑 `loom upgrade --project "$PROJECT" --to "$RELEASE" --check`。通过后按授权升级。用 `loom upgrade --status` 查回执；TUI 或布局用 `loom status`、`loom layout get` 检查。
