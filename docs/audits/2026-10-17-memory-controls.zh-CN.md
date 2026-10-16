# 记忆管理收尾与控制台替代核对

## 本轮接线

官方来源同 `frontends/raft/adoption.json`：botiverse/raft-source `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2，raft-ui 0.5.64，原文件及许可证不变。没有可整页复制的频道数据库记忆权限页：本地组合沿用官方 `TaskProperties`/`HistoryTimeline` 的折叠与 Timeline 层级、`useTimeFormatter`；权限使用 `ChannelOverflowMenu`/`OverflowSheet` 入口、Dialog、FormField、Select 和 Switch（参照 `settings/ServerLabRow.tsx` 原生状态参数）。是结构移植与本地业务接线，不宣称原版记忆整页复制。

- 记忆详情展开修订历史才读 `memory.history`，按后端顺序展示操作、时间、Human/实例及已知模型；逐条展开简介／正文。历史上限20条，截断显示提示。切换条目／修订时卸载旧读取，忽略过期响应。
- 状态筛选新增“已删除”，通过 Human `includeDeleted` 获取墓碑；历史正文、简介仍以服务器清空后的结果为准，不恢复缓存。全文搜索仍仅有效记忆。
- 频道标题设置 → 记忆权限：默认读取／写入及每个当前实例的“跟随频道／允许／禁止”，显示草稿保存后的效果。成员使用当前名称，不以内部ID作为标签。
- `policyPatch` 只提交实际改动，继承写null，不清掉未呈现的离开成员覆盖。保存使用读取时的expectedRevision与共享WriteIntentSlot；未知结果只核实原请求或放弃，未解决前禁止关闭和导航。冲突保留草稿并提供明确重新读取，不自动覆写。
- 不新增后端能力，不改变Worker、Side、记忆投递、频道隔离或自动记忆规则。

## 控制台替代清单（源码核对，不冒充本轮全功能重验）

| 控制台能力                           | 正式前端落点／现状                                                        | 删除前处理                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 频道历史、队列、成员、私聊           | ChannelApp、ChannelMembers、PrivateBoxRow                                 | 已接；本轮未重跑全部聊天链路                                                                           |
| Role创建修订删除、实例添加移除／重启 | AgentPage、RoleEditor、RuntimeControl                                     | 已接，沿用既有证据                                                                                     |
| Fork／Side、丢弃                     | useInstanceBranches、SideWorkspace                                        | 已接，沿用既有证据                                                                                     |
| 急停／恢复、阻塞放弃                 | ChannelControl、BlockedWorkControl                                        | 已接，沿用既有证据                                                                                     |
| 记忆列表、检索、历史、管理、读写设置 | MemoryPage、MemoryHistory、MemoryPolicyDialog                             | 本轮补齐Human墓碑／历史／设置；测试见evidence                                                          |
| 运行设置                             | RuntimeSettings                                                           | 已接；字段完整性仍需删除前逐项确认                                                                     |
| 任务创建、消息列、完成／关闭         | ChannelTasks、TaskCreate、ThreadWorkspace、TaskBoardClient                | 已接，正式页走task.workflow.update而非复刻旧按钮                                                       |
| 允许实例自主创建任务开关             | 控制台view-tasks.ts；正式loom目录无对应绑定                               | **缺入口**，优先补频道设置；不改变默认false                                                            |
| 24小时／7天按实例用量汇总            | 控制台view-usage.ts → usage.summary；正式loom目录无调用                   | **缺汇总**；已有单次Run用量不能代替它                                                                  |
| RunAttempt诊断明细                   | RunUsageDialog已有token、生成明细、缺口、上下文和本轮压缩                 | **部分**：旧console还展示冷／热执行、恢复耗时、final中断、进程清扫及费用完整性等；需核对并保留必要诊断 |
| 会话代数、当前会话累计压缩等状态     | 控制台model.ts assembleInstanceStatuses；正式未绑定sessionCompactionCount | **部分**：不能用单轮压缩数冒充会话累计                                                                 |
| legacy记忆导入                       | 旧persona专属兼容入口，evo不创建此类实例                                  | 不移植为新Role实例功能；按既有退役边界保留底层兼容                                                     |

结论：本轮不删除控制台。下一批按“频道任务创建开关 → 用量汇总与必要运行／会话诊断 → 删除前部署脚本和字段核对”的顺序收口，不扩展新的业务模块。

## 验证边界

单测先失败后实现：策略最小差量、继承null、未知结果同键同修订；墓碑过滤请求。桌面1440×1000／手机390×844，DPR1的真实Kernel/API临时fixture覆盖历史展开、删除后历史清空、默认权限／成员覆盖／返回继承、保存响应丢失原请求核实、并发修订冲突后重新读取，以及既有记忆编辑管理回归。没有运行付费CLI或完整后端套件。实际通过结果与安全重启记录在同名evidence中。
