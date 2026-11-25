# SKILL-LOOM-0 结果

交付 `skills/project-loom/SKILL.md`，共 70 行。技能规定各角色的启动参数、投递模式、查证顺序、波次交付、独立复核和接替流程，并纳入授权、缺陷复现和原生最终回复格式。 [技能](../../skills/project-loom/SKILL.md)

## 接口差异

技能采用 LOOM-CLI-0 的目标接口。以下差异来自本次验证的仓库快照。 [LOOM-CLI-0 任务卡](../LOOM-CLI-0/TASK.md) · [协议 v2](../../docs/PROTOCOL-v2.md)

| 项目 | 对照结果 |
| --- | --- |
| 主入口 | `bin/loom --help` 列出 `hist`、`state` 和 `ls`。`send --help` 单独可用。主入口的 `spawn`、`daemon`、`stop`、`handover` 子命令探针均返回未知命令，退出码 2。独立入口 `./handover/loom handover --help` 返回 `loom handover <leader\|auditor\|super> --project P [--to <新地址>]`，退出码 0。 |
| 启动参数 | 协议 v2 将 Claude 固定到 `claude-tui` 并提到 `--skill`。LOOM-CLI-0 的签名明确 `--mode tui\|headless`、必填 `--effort` 和可选 `--parent`，允许经 OAR 启动无头 Claude，仅此模式设置 `CLAUDE_CODE_ENTRYPOINT=loom`。技能按该签名写示例，首轮上下文通过提示词传入。 |
| 投递与查证 | 现行 `send` 走 TUI 收件箱，支持 `--from` 与 `--project`，成功回执使用 `id`、`requestedMode`、`mode` 和 `status`。v2 将投递身份写作 `deliveryId`，并通过 `state` 查有效模式及账本。当前 `state` 的投递列表为空，活动的无头会话返回 `unsupported`。现行 `hist` 从索引绑定的原生转录取 L1/L2，v2 设计采用 OAR 事件投影。 |
| 波次与抄送 | v2 设计在派工轮结束时封存，迟到结果按波补投。现有 relay 的托管分支含补投逻辑，旧分支的迟到结果只归档。已核对的旧分支仅按 `FAILED` 抄送，托管分支把批次送往 `parent`。技能要求的 `FAILED`／`MISMATCH` 自动抄送还需在 daemon 串联后验证。 |
| 索引字段 | v2 建议将 `transcriptPath` 和 `baseCommit` 移出核心索引。LOOM-CLI-0 明确保留二者供历史与证据卡使用。 |

## 验证

- `skill-creator` 的 `quick_validate.py`、示例 shell 语法检查和 120 行上限检查通过，退出码均为 0。
- 在本卡隔离目录用 Node v25.9.0 运行 `node --test --test-skip-pattern=…`，138 项通过，退出码 0。CLI、watch 和 app-server 涉及历史数据的路径使用本次生成的合成输入。需要既有会话、hook 或屏幕原样回放的用例按名称排除，仓库原始夹具的全量回归仍未验证。
- CLI 探针仅调用帮助入口。真实角色启动、消息投递及接替的端到端验证待主入口集成。临时测试目录已清理，持久写入仅有技能和本记录。

STATUS: done
