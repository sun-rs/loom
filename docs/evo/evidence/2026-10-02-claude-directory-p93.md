# P93：Claude 全盘找文件的原生对照

结论：**本次原生 CLI 没有复现全盘搜索；未发现 Loom 漏传目录的证据，但还不能把 P92 唯一归因为模型或 Loom 协议。** 没有修改产品、重启服务或恢复 P92 已停止频道。Task 整体验收仍未通过。

## 已确认

- P92 Room 的 `channel_workspace_json` 包含正确的附加项目目录；对应 placement 使用 channel-home mount，Claude 为冷路径。
- 同一 Claude 原生会话在 P91 的 02:04:27Z 工具结果中收到过完整附加目录绝对路径。该会话到 P92 失败没有 compact_boundary；不是压缩丢掉路径的已知案例。
- 当前代码接线：`daemon-execution-workspace-composition.ts:96–116` 从 mount 解析 cwd/附加目录；`runtime-profile-composition.ts:327–330` 传给 adapter；`runtime-implementation-registry.ts:618–639` 传给 Claude 驱动；`claude-stream-json-driver.mjs:178` 转为原生 `--add-dir=`。这证明代码路径，不冒充 P92 历史进程 argv 的现场捕获。
- 免费真实二进制探针：Claude Code 2.1.285，指向仅本机模拟 Messages API、假密钥，无供应商调用。新建和 resume 两次请求都在原生环境 `system-reminder` 中包含 `Additional working directories` 和正确绝对路径。它位于 messages 内容，并非顶层 system 数组；不能仅搜索 system 字段就断言目录缺失。
- 首次免费探针未加载产品连接别名，原生默认解析为 sonnet-5-5；补齐产品 `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5` 后免费重做，结果相同。付费对照从开始即使用产品连接函数和 sonnet-5，没有付费使用其他模型。

## 有界付费对照

授权依据：负责人要求“继续核查，确认是loom问题还是原生cli也犯错”，延续已授权的最终测试调查。一个新原生 session 两轮，`sonnet / low`，实际输出模型 `claude-sonnet-5`；每次最多3生成、60秒，遇 Bash/权限请求立即停止，不补跑。cwd 是空的临时目录，同一个真实项目通过 `--add-dir=` 提供；两次沿用同一 session。

第一轮仅说准备好了。第二轮要求只读查看“附加目录 scripts/workbench-launch-receipt.mjs”，验证严格相等及异常 code，没有在问题中给绝对项目路径。模型直接用 Read 读取正确绝对文件路径，然后生成最小 Node 实验，没有 `find /`。在 Bash 权限边界主动停止，**没有执行实验或完成整项任务**。

3个唯一 assistant message，共34,319报告输入、21,302缓存输入、13,017未缓存输入。stream-json 同一 message ID 的多个内容帧去重；不是5次生成。这里只比较定位行为，不计算对 P92 的效率倍率。

## 归因边界与后续取舍

直接失败机制已确定：P92 模型选择无界的全盘 find，等待在工具执行，而非队列或 session 重建。原生 CLI 能正确呈现附加目录，原生短会话同模型也会正确使用；因此没有依据修 session 生命周期或增加一个 Task 调度器。

尚未分离的变量：P92 是长期角色会话、带 Worker/Task 工具协议和历史；本次是短原生会话，仅开放 Read/Glob/Bash、默认权限，未加载 Loom standing prompt。不能据此宣称原生永不犯错，也不能证明 Loom 提示词导致遗忘。没有捕获 P92 原始上游请求，不能以当前免费探针替代那一帧历史证据。

现在不新增大段提示词或特殊 Task 流程。若继续做因果实验，应在隔离副本中固定同一历史上下文和工具集，只改变目录呈现位置；不得在正式实例上插入诊断对话，也不应扩大为四家重复门禁。若选择产品改进，优先评估“当前执行工作区的结构化、短且可查询的定位信息”，它应复用已有 mount 权威来源；但本轮不足以授权宣称这是根因修复。

[脱敏证据](2026-10-02-claude-directory-p93.json)。本机探针及受控执行脚本保存在 `/private/tmp/loom-p93-directory-probe/`，临时文件不是长期可复现依赖。正式服务和 Task 状态未改。
