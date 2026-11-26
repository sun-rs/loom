# INTEG-3 集成结果

基于 `main` 的 `46a77cf7` 创建独立工作树 `/Users/sun/Code/repos/loom-integ3`，分支为 `integ/main-3`。

| 卡片 | 源分支提交 | 集成合并提交 |
| --- | --- | --- |
| ROT-TUNE-2 | `d769c67a` | `d7f86d5e` |
| TOOLGUARD-2 | `37a17bc2` | `dce38d82` |

两张卡先在原工作树提交，再按表中顺序合并。提交带有 INTEG-2 流程指定的共同作者。

## 冲突与解法

- ROT-TUNE-2 的 `daemon/sessions.mjs` 保留 `Do now` 单列及「接管生效」信封。常规 v2 换班使用另一方已核对的交接单，紧急 P0 路径使用机械事实卡。
- ROT-TUNE-2 的 `daemon/supervisor.test.mjs` 在同一用例检查交接单先于继任者启动核对、首报核对后交付 `Do now`、首个完整阶段内核对决定及锁定另一方换班。
- ROT-TUNE-2 的 `skills/loom/SKILL.md` 合并交接单核对、首报与决定的命令、`Do now` 和自动提醒。原生签收后开始计时。
- TOOLGUARD-2 的 `cli/loom.mjs` 将历史分页选项与 `lint`、`audit-findings` 注册合并。`cli/status.mjs` 展示最近两条重试理由，保留高权限 Worker 状态。
- TOOLGUARD-2 的 `daemon/supervisor.mjs` 合并拒绝回执解析和换班待办。门禁关闭将实际门禁 ID 传给 Auditor 唤醒预算，并保留 v2 首阶段的决定记录。重试继续经过 socket 身份和资深角色规则检查。
- 集成校验提交 `3be0940a` 将新增轮换策略测试接到现有夹具启动器，测试仍调用固定的 `/usr/bin/git`。夹具修正 `eb6cedae` 将 Worker 夹具的 TTL 增至 45 秒，先验证 Worker 权限，再验证其他角色。此前并行重跑中有一次旧会话调用超时。热升级和按原期限释放的断言继续执行。

## 验证

- `npm ci`、`npm run lint` 和 `git diff --check` 通过。Lint 扫描 309 个文件，定向测试 41 项通过。
- 在 `eb6cedae` 顺序执行两轮 `npm test -- --test-concurrency=4`。每轮 805 项通过，失败、取消及跳过均为 0。 [第一轮](/private/tmp/loom-integ3-verified-1.log) · [第二轮](/private/tmp/loom-integ3-verified-2.log)
- 从归档的 `f733e616` 启动一次性项目。注入候选附着故障后旧版本恢复写入并继续投递。 修复候选后切换成功，原生会话绑定和托管、外部两类 socket 能力保持有效。 [回滚与切换日志](/private/tmp/loom-integ3-base-upgrade.log)
- 从归档的 `8fc550c0` 热升级另一个一次性项目。原有 Leader、Auditor、Worker 的 PID 和权限保持有效，换班记录为零。 Worker 剩余 TTL 从 43,886 ms 降至 38,202 ms，按原期限释放。 同一个 Status TUI 在切换中断后重连。 [旧会话连续性日志](/private/tmp/loom-integ3-legacy-upgrade.log)

集成期间未更新 `main` 或推送分支。期间 `main` 独立前进至 `d71d1041`，其新增卡片和研究文档与本集成的改动路径无交集。

STATUS: done
