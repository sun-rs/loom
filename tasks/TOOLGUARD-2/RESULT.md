# TOOLGUARD-2 结果

STATUS: done

- Shell 工具拒绝回执包含可以复制的 `senior-tool --retry` 命令。拒绝 ID 绑定原会话、原命令和工作目录，跨门禁作废，且只可使用一次。手工重试按字面量参数匹配等价的空白、引号和转义。带管道、重定向或展开的命令可按原文或拒绝 ID 重试。
- 重试理由要求一个短句。含至少三个有效词和八个文字或数字字符的理由通过基本检查。确认 Worker 或投递故障时，可以省略理由并记录 `worker-unavailable`。Status 显示近期理由，历史保留各轮的拒绝与重试记录。
- Auditor 超过唤醒预算时，每个门禁区间只发一次通知，保留首次超限的计数和采样时间。门禁完成后，通知记录对应的门禁 ID。
- `loom hist --before` 排除指定轮次，角色时间线支持 `turn:ADDR#N`。 `--page N` 从最新页编号，页大小可用 `--turns N` 设置。 `--all` 输出全部 L1 摘要。
- `npm ci` 安装成功。定向测试通过，全量 `npm test -- --test-concurrency=4` 共 766 项通过，`git diff --check` 通过。
- 在 `b5338fe4` 上完成，改动保留在 `infra/toolguard-2` 工作树，未提交。
