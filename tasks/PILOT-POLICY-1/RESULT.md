# PILOT-POLICY-1 结果

- `examples/policy.json` 移除了 Claude 暂停说明和 `claude` 拒绝条目，保留 `luna` 与 `gpt-6-luna` 的拒绝示例。`super`、`leader` 和 `auditor` 各有两家 CLI 厂商。`auditor` 首选 agy，`worker` 首选 Codex。
- `cli/loom.test.mjs` 新增了对 Claude 拒绝条目和三个高级角色厂商数量的断言。
- `node --test cli/loom.test.mjs` 共 8 项，6 项通过，2 项失败。策略示例测试通过。Worker 准入和项目看板切换测试在监听 `loomd.sock` 时收到 `listen EPERM`。使用 `TMPDIR=/private/tmp` 重试后结果相同。
- `git diff --check` 通过。产品新增 2 行、删除 3 行，测试新增 2 行。
- `git add` 创建工作树的 `index.lock` 时被权限限制拒绝，因此未提交。
