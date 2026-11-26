# LEADER-ROT-1 结果

STATUS: done

## R21 与决策角色

- Leader 拆卡、派工、读回执和证据摘要、打包门禁并作下一步决定。候选集成、固定 SHA 的全量测试和获授权合入交给集成 Worker。Auditor 根据门禁包裁决，证据不足时索取集成 Worker 的证据卡。
- 普通门禁可直接用 Worker 证据打包。Reviewer 由在任 Auditor 在确需深查时启动，同项目同门禁只收一次派单，跨 loomd 重启仍去重。有效结论回送一次，计入 Auditor 的原生唤醒预算。收到转交结论的 Leader 按回执路径转发原文。

## 分级工具守卫

- `roles.<role>.toolGuard` 对 Leader 和 Auditor 默认开启，按原生会话启动配置生效。Loom 命令、`.project/` 读写、Git 摘要和最多 200 行的定点读取可直接执行。重型命令首次由原生钩子拒绝，用 `"$LOOM_BIN" senior-tool --reason "理由" -- "命令"` 重试。该入口在原会话环境执行，截取末尾 40 行及最多 12,000 字节，保留命令退出码。
- loomd 根据 Worker 启动失败、执行异常或投递超过 SLA 自动批准无理由的限尾重试，记录 `worker-unavailable`。每角色每门禁第 4 次重试向 Super 发一次通知。`loom status` 和 `loom hist` 显示拒绝、重试与理由。最近一小时的新增上下文达到 5,000 token，且工具输出估计占比超过 35% 时，loomd 发出上下文消耗通知。
- Claude、agy、Codex 用原生预执行钩子，OpenCode 用启动时加载的权限钩子。隔离夹具验证了拒绝、定点读取、策略关闭、限尾、第四次通知、故障放行和理由回查。[Claude Code hooks](https://code.claude.com/docs/en/hooks) · [Codex Hooks](https://developers.openai.com/codex/hooks) · [OpenCode Server 插件](https://opencode.ai/docs/build/plugins/server)

## 换班

- loomd 共用 Leader／Auditor 的门禁与上下文预算逻辑。Leader 最近一次原生调用超过默认 150,000 输入 token，或已完成配置为换班点的门禁时，等卡片结算后在 `loom status` 和通知历史给出建议，由 Super 安排换班。
- `--handover-from` 首轮送达 SHA-256 交接文件指针。文件包括开放卡片和波次、待处理续作及投递、最近门禁裁决原文和原件路径、策略与裁决账本路径。成功首轮必须回报交接文件末尾的确认码，loomd 才切换路由并退休前任。隔离回归覆盖长简报、首轮缺少确认、待投消息和在途结果。旧会话显示 `Release paths · leader … legacy CLI path`，继任确认后显示 `Release paths · none`。agy 夹具验证了稳定 hook shim、项目 `LOOM_BIN` 路径和原生提问拦截。

## pilot-2 目标 4 只读回放

用 [replay.mjs](replay.mjs) 从 `loom hist --role leader --level L2 --with-calls` 定位 Leader 原生记录。目标 4 样本为第 46–74 轮，共 29 轮和 96 次模型调用。原始 token 为输入与输出之和，含缓存输入。回放保留历史调用与输出，使用同一会话实际首轮的 160,530 原始 token 估算每次换班开销，并以卡片投递和最终门禁裁决重建空档。守卫场景假定被拦操作转派 Worker，按工具输出估算从后续上下文中扣除；表内仅计 Leader。

| 场景 | Leader 原始 token | 节省 token | 目标 4 最高单次输入 | 新增简报轮 |
|---|---:|---:|---:|---:|
| 历史 | 25,813,876 | 0 | 331,993 | 0 |
| 仅工具守卫 | 17,966,422 | 7,847,454 | 228,097 | 0 |
| 仅门禁换班 | 15,087,341 | 10,726,535 | 265,658 | 1 |
| 仅默认 150,000 阈值换班 | 9,213,483 | 16,600,393 | 150,734 | 2 |
| 工具守卫、门禁和阈值换班 | 7,398,413 | 18,415,463 | 151,198 | 2 |

合并场景估计节省 71.3%，已计入两轮共 321,060 原始 token 的简报开销。151,198 是样本中的峰值。实际换班建议要等安全边界，150,000 为触发阈值。

| 目标 4 门禁 | 文件读取命令或工具调用 | 搜索／grep 调用 | 实际测试执行调用 |
|---|---:|---:|---:|
| G4-TESTS | 20 | 1 | 0 |
| G4-MERGE | 10 | 2 | 4 |

卡面先验统计为测试 47（46%）、读取／搜索 35（21%）、Git 11。逐条回放同一 478 步，按实际工具名和 shell 参数识别 12 个执行测试的工具调用，全部会被拦；78 个读取／搜索调用（包括 `.project/` 证据和回执），22 个会被拦；14 个独立 `git merge/rebase/cherry-pick/worktree add` 子命令全部会被拦。脚本输出对应的原生步号。独立执行命令和工具输出记录的计数不同，卡面的汇总没有逐条映射。

`npm test` 共 404 项通过，失败、取消、跳过均为 0。`git diff --check` 通过。pilot-2 仅用于读取历史，未操作其窗格、部署或换班。交付留在当前工作树，未提交。
