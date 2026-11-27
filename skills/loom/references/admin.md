# Super 运维

1. Host 授权与账号
2. 换班例外
3. 发布与排障
4. Claude CCP 与恢复

## Host 授权与账号

核对卡面命令、可写路径和额度。用 `loom grant "$TASK" host --reason "$WHY" --uses "$N"`，获准外写逐条加 `--write PATH`，按需加 `--ttl`。具名波可在 `roles.worker.tiers` 预授权 host。`loom accounts --json` 读脱敏快照。只有已认证 Super 或持有效 host 授权的 Worker 可按授权用 `--refresh` 实时核对。外部 Super 需使用 `LOOM_EXTERNAL_SUPER=1`。

## 换班例外

对现任目标用 `loom rotate --target leader|auditor`，需要时加 `--prepare` 或获准的 `--cli`、`--model`、`--effort`。v2 阶段锁由 loomd 判定。

## 发布与排障

先跑 `loom upgrade --project "$PROJECT" --to "$RELEASE" --check`。通过后按授权升级。用 `loom upgrade --status` 查回执；TUI 或布局用 `loom status`、`loom layout get` 检查。

## Claude CCP 与恢复

按用户 2026-11-27 裁决，所有 Claude Code 调用必须经 CCP 入口（默认 `/Users/sun/.local/bin/claude`，禁止直接执行 `~/.local/share/claude/versions/*` 或 realpath 绕过，非 CCP 入口由 loomd 硬拒绝 `ccp-required`）。经 CCP 启动的 Claude 不注入 loom hooks/statusLine，loom 改读 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl` 追踪回合、投递与上下文。已结束的常驻 Claude 会话可用 `LOOM_EXTERNAL_SUPER=1 loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" --resume-session "$SESSION_ID"` 经 CCP 恢复原会话上下文。
