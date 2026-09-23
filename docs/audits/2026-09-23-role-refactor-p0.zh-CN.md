# Role 重构 P0：合同确认与基线核查

日期：2026-09-23。当前状态：**P0 基线门禁已收敛，可进入 P1 隔离施工**。下方先保留初次只读核查，再记录后续修复与正式服务验证；尚未接线或迁移 Role/Instance。

## 用户确认

施工设计已认可，继续按 P0–P8 顺序执行。新增 [UI 合同](../design/role-instance-ui-contract.zh-CN.md)：保留大页结构；Role 管理替代 Agent 管理；不出现记忆/MCP tab；聊天 tab 显示 Role 实例参与频道；聊天左栏无私聊分区；私聊、Side、消息列、实例动态共用右侧详情和已有折叠导航。

源码核查：当前 Agent tabs 已没有 memory/MCP，保持此边界，不宣传为本批新删除。AgentChatPane 仍含 channel/direct 两组、左栏仍用 directConversationEntries，属于 P6 明确改造范围；不提前接不存在的 Role 后端。

## 基线证据

HEAD 为 `5122795d0002e52c03048ac1ef186ea119f908b9`，工作树含先前修改及未提交文件。记录 [选定源码摘要](../evidence/2026-09-23-role-refactor-p0/source-snapshot.json)，这是核查快照，不是干净冻结版本、完整备份或正式部署证明。源码 schema 为 58，本批未打开正式数据库，因此不推断运行库版本。

重新执行 `node --test packages/core/test/source-boundary.test.ts packages/ui-tokens/test/ui-tokens.test.ts`：16 项中 14 通过、2 失败。见 [原始输出](../evidence/2026-09-23-role-refactor-p0/targeted-gates.txt)。

| 失败                          | 已核实来源                                                     | 后续处理                                                                 |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| RoomKernel 行数 7,102 > 6,925 | HEAD 已有相同行数；当前未提交 diff 仅 schema 57→58，未增加行数 | 按领域 owner 提取完整职责，保留行为回归；不提高上限                      |
| interaction icon 冻结哈希不符 | 当前 sprite 与对应测试均和 HEAD 一致，失败不是 Role 新改动造成 | 对比符号来源和历史变更，区分已批准增量与意外差异；不替换冻结哈希蒙混通过 |

全仓格式检查初次包含新 UI 文档及原有 12 项格式问题；新文档经格式化修正后再次核查。原有项包括历史 wake/delivery 测试、产品文档和 scratchpad，尚未改动。此处不以历史全仓通过记录覆盖当前失败。

## 初次核查时的 P0 剩余门槛

1. 收敛上述来源明确的门禁问题，重新执行完整检查；不得把它们作为“已知失败”直接跳到正式 P1 迁移。
2. 冻结实际待采用源码和资产清单，区分已有部署与本次目标；现有磁盘 bundle 不自动等于运行实例资产。
3. 将逐 CLI 能力、Side 权限与 private box 目标 ACL 验证分别作为 P2–P5 的进入/发布条件保留，不能把基础沙箱实验升级为完整能力验收。

无新增提交、推送、真实 Provider 调用或正式重启。下一批先修复 P0 基线门槛，再进入 Role/实例聚合。

## 后续修复批次：2026-09-23

本节补充前述只读基线，不覆盖其失败证据。本批开始修改产品代码，仍未接线 Role/Instance 聚合或迁移正式身份。

- RoomKernel 原调度输入构建整体提取到 `placement-planner-projection.ts`，保留 SQL、排序、容量及权限条件。Kernel 仍拥有事务与写入。文件由 7,102 行降至 6,910 行，上限仍为 6,925。
- 图标差异来自提交 `935a2a388fb80f8eafda07a14465ff009a1c5e7c` 的 upload、clipboard、triangle-alert。测试逐字断言三项完整 symbol，然后验证原冻结基线；没有修改生产 SVG 或原 SHA256。来源分别见 [资料字段](2026-09-18-agent-profile-field-ui.zh-CN.md)、[设置与动态](2026-09-18-settings-activity-repair.zh-CN.md)、[已删除 Agent](2026-09-19-deleted-agent-message-ui.zh-CN.md) 审计。
- 修正前述 12 个既有格式问题，只做 Prettier 格式化。
- 先重现原两项失败，再执行 source-boundary/durable-placement 53 项与 ui-tokens 14 项，均通过；独立 TypeScript 检查通过。

全仓 `npm run check` 完整复跑通过：packages 1,787 通过 / 17 项 opt-in 跳过、Web 481 通过、回调 34 通过；其余 check 子门禁亦完成。格式、diff 与正式 Web 构建通过。正式重启与页面验证见文末。P0 完成不代表 P1 身份聚合已实现，旧 Agent/DM 数据不在本批转换。

### 完整检查揭示的后续旧测试问题

首轮完整检查的 packages 测试为 1,804 项、1,787 通过、17 项 opt-in 跳过、零失败；随后 Web 的 481 项有 11 项失败。原先 packages 的两项失败使串行 check 没有执行到这些 Web 门禁，不能将本次新发现称为新引入缺陷。

这 11 项均经当前 owner 核查，修复测试定位与已批准合同，不修改生产 Web 行为：

| 旧断言                                           | 当前合同与更新                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 私聊头像必须单行调用 openAgentPeek               | 活跃身份仍调用该入口，tombstoned 分支打开不可用资料；测试同时检查两条路径              |
| 报告问题按钮存在                                 | 用户已要求退役，检查入口/专用状态不出现，保留活动诊断和重置权限检查                    |
| 选中频道始终500字重                              | 普通行500；选中/未读700，与现有侧栏合同一致                                            |
| 页脚接收全部Agent                                | 排除 tombstoned，保持原动态展示owner                                                   |
| App和Agent页面自己持有resizer及宽度常量          | 检查调用共享 ConversationLayoutShell / DirectoryWidthLayout，并检查owner内原尺寸和导出 |
| 文件预览使用裸div                                | 使用共享DialogLayer，仍验证document.body portal和焦点协议                              |
| reaction title只含label；间距条件只有两种variant | title允许专门提示；field同样4px，reaction仍4px、gutter8px、靠右                        |
| 全局任务直接用responsive hook                    | preference hook委派responsive hook，显式选择仍优先                                     |
| 任务标记直接读取taskAgent名字                    | 先按assigneeId查canonical实体，fallback也校验ID，避免显示错人                          |
| 更多由showMore/showAdvanced变量驱动              | 原生details/summary承载RuntimeEnvironmentEditor                                        |

随后回调回归中 19 项失败来自测试 scope 缺少现有依赖，或旧的“mark后导航”假设。修复测试环境的 openingKey、surfaceRef、预览状态、Inbox打开状态；使用实际 `useSearchChannelPreview` owner 更新URL，按当前 navigation.resolve 回包补齐thread身份。延迟响应注入到真实导航请求，继续断言失效后不能更新当前thread/preview，以及pending释放、旧all-read不能覆盖新操作。打开动态不提前标记已读，由正文可见范围ACK；见 [系统通知与可见范围已读](2026-09-19-system-notices-and-restore-read.zh-CN.md)。34项回调回归通过。

上述是测试维护，不是本批新增 UI 产品行为；没有通过跳过、删掉失败测试或放宽视觉阈值让检查通过。

修复目标的 [源码与 Web 构建摘要](../evidence/2026-09-23-role-refactor-p0/repair-source-snapshot.json) 保留本批选择性证据；工作树并非干净提交，不能将其当作正式 Role 发布包。

### 正式服务验证与退出结论

使用既有受保护的重启脚本：再次检查可重启状态、SQLite在线备份、逐文件校验、迁移预检、确认期间无canonical变更，再SIGTERM旧进程并启动冻结Web资产。备份目录 `~/.rah/backups/pre-restart-6494d419-49f4-47d2-8ba4-5cfbf9e34af0`；旧PID 27573退出，新PID 68893监听原loopback/LAN/Tailnet地址。数据库在重启前后都是schema58，本批没有新schema迁移。

正式Web构建 `6d82b67b3eafbb7586f045736b173182000a68bbccba18d16edbc46b764e0189` 已与HTTP页面meta核对。在用户原有内置浏览器重载正式频道，确认历史消息、7位成员入口、composer；打开现有4回复消息列后返回成功，截图已目视检查。这是正式服务恢复的有限浏览器冒烟验证，不是新Role产品流程或Raft双边验收。

P0已满足进入P1的基线要求。P1仍仅在临时数据库和假适配器中实现Role版本、实例principal和旧历史兼容；P2–P5能力/权限门槛仍然有效。未提交、推送或运行付费Provider测试。
