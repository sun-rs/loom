# SKILL-VERIFY-1 结果

STATUS: done

- `loom lint` 检查 Git 跟踪和未忽略的新 JavaScript 源文件，`npm test` 的 `pretest` 会先跑检查。违规回执列出文件、行列和修根因指令。测试用受控启动器固定基础工具的路径，其他可执行文件必须位于已登记的 fixture 目录。项目在 `loom.lint.json` 按模块文件路径配置外发白名单。
- Worker 证据卡记录断言的原行及替换行、新增 skip/only 和被删用例或文件。预期红灯的卡链接原生失败及同一命令后续通过的证据。卡片同时列出实际 lint 结果和已观测、仍缺证的不变量。
- 移除 Reviewer 的新建入口、门禁配额和独立成本行。已有策略的 `roles.reviewer` 会提示迁移并在运行时忽略。原生历史可按会话地址查阅。Auditor 在阶段边界审阅门禁包和 Worker 证据，由 Worker 重跑抽中的命令。
- `loom audit-findings` 与 `loom status --json` 提供每阶段的漏检分类计数。Auditor 登记证据并关联项目内的回归测试或 lint 路径。尚有未关联回归的发现时，阶段或门禁无法登记完成。
- 验证通过的命令为 `loom lint`、`npm test -- --test-concurrency=4` 和 `git diff --check`。Lint 检查 280 个文件，全量测试 732 项通过。
- 改动留在 `infra/skill-verify` 工作树，未提交。
