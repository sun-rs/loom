# 启动记忆传输修复：完整索引、原生恢复与刷新退路

承接[正式续聊验证](2026-09-21-scheduling-followthrough.zh-CN.md)。本批只处理启动上下文
重复，不把已读/已有发言当成已完成请求，也不清理 pending Activation。

## 设计与来源

Raft Computer 1.0.18 的 startup/compaction 要求读取完整原始 MEMORY，正文 notes 按需；
沿用本地 `raft-memory/upstream-standing-prompt.ts` 已登记来源。
Raft 实测 idle 输入无需重新 startup；RAH 当前每 Activation 恢复原生会话，不能仅凭
“进程启动很快”忽略上下文重复成本。跨 Activation 常驻仍是独立生命周期工作。

本批是 **RAH 传输适配，不是 Raft 原码复制**：由 daemon 将完整原文作为记忆数据放入
原生 system/developer 输入，通过 owner-private 临时文件传给 Driver，避免大索引进入
argv/环境长度限制。文件不构成新的记忆 owner，release 删除临时副本。原始 MEMORY
仍由 Agent 持有，不切分、摘要、重排或丢弃 BOM/换行，不读取所有 notes。

职责：daemon 编排 prompt；AgentHost 原生 Driver 仅读取文件并传输；既有
ProviderSessionStore 保存首次 system snapshot 的 SHA-256；Worker startup 每次仍从
原 Agent 目录安全读取完整当前索引。无 Kernel schema、ACK、Task 或调度队列变更。

## 实测否决过的错误假设

初版在每次恢复时传入新 prompt，并把这次准备的 digest 当作已应用的 system 内容。
隔离测试修改 MEMORY 中的唯一口令后，Codex 与 Claude 都仍返回旧口令；磁盘已是
新口令，startup 却说“本次 system 已提供”，所以这条假设被真实反例否决。
这说明 API 接收参数、Host 准备了文件，不足以证明原生恢复替换了 system 内容。
该初版没有部署到正式环境。

修正版保留同一原生会话首次传入的索引版本，**不因索引改动重置 Provider 会话**：

| 场景                           | startup 行为                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| 新原生会话                     | 提供完整 system 索引；startup 校验当前文件一致后仅提示读取该完整数据 |
| 同会话、当前索引与首次快照一致 | 不向工具历史再追加完整副本；仍读取并校验当前文件                     |
| 同会话、索引已经变化           | 输出当前完整原文，不假设 resume 新 system 已生效                     |
| 旧会话没有快照元数据           | 完整输出，不猜“以前读过”                                             |
| 原生恢复失败、确实建立新会话   | 新 session 记录本次完整快照；旧范围不冒充新授权                      |
| 读取失败、owner 不符、输出失败 | 失败并保留原有 delivery/ACK 错误边界                                 |

记忆变化后，后续 startup 可能继续返回完整索引，直到真正建立新的原生会话。这是明确
的保守退路，不宣称彻底解决所有历史增长。压缩后完整重读要求不变；没有声称 Host 能
证明模型读懂记忆。原生 session/digest 仅为传输元数据，绝不用于完成 canonical 工作。

## 兼容与开关

Daemon 配置 `startupMemoryTransport: "tool" | "system"`；通过修正版真实门禁后，默认
对支持的两家启用 system；显式 `tool` 为原路径回退。
仅 Claude/Codex 驱动支持本次传输；Kimi/OpenCode 不因此改变。
传输模式有独立稳定 prompt digest，首次启用会选择该模式的 Provider session key，
旧文件保留；后续 MEMORY 编辑不改变 key。不能把首次模式迁移产生的新会话耗时当成
同历史性能提升。回退到 tool 使用原模式，不删除历史会话和私有记忆。

原生连续性记录增加可选 snapshot digest，旧记录照常读取、退回完整索引。新字段不
存记忆内容、凭据、Room 状态或模型阅读证明。继承/静态环境不能伪造该传输标记。

## 验证范围

单元测试先失败再实现，覆盖完整大索引与 BOM/CRLF、私有文件和链接拒绝、临时文件
清理、更新索引回退、缺失元数据、原生替换会话、跨 Agent/Run 元数据和存储重读。

真实门禁绑定 Claude sonnet/low、Codex gpt-5.6-luna/low，拒绝替换模型。普通两轮
口令续聊通过；记忆刷新反例用于阻止错误方案进入正式环境。最终刷新门禁及交付检查
结果在收尾追加，不以候选代码或单元通过替代正式验收。

另一项“答完追加消息仍跑只读 follow-up”未在本批闭合。取消它需要明确的处理义务证明，
不能由本批 system 传输 digest、精确展示收据、后续发帖计数或进程退出代替。

## 本批交付结果

- 修正版真实刷新门禁：Claude、Codex 各两轮，同一原生会话读取从第 1 版更新至第 2 版的唯一口令，全部正确。证据：[刷新门禁](../evidence/2026-09-21-scheduling-preparation/system-memory-refresh.json)。普通索引不变续聊见[真实 CLI 证据](../evidence/2026-09-21-scheduling-preparation/system-memory-real-cli.json)。这些是隔离真实 CLI 门禁，不是同历史 Raft 性能对比。
- 本批相关 31 项测试通过；类型检查、parity 34 项、daemon source-boundary 检查通过。
- 完整 `npm run check`：主测试 1796 项，1777 通过、17 跳过、2 失败。失败为已有 RoomKernel 大小门禁和 UI 图标冻结 hash；因此完整检查未通过，不能宣称全绿。
- `npm run format:check` 仍有先前 12 个文件的格式问题；本批文件单独格式化检查，`git diff --check` 通过。
- 正式重启前通过 active-work 与备份完整性检查；备份 `/Users/sun/.rah/backups/pre-restart-0564315b-8541-415a-931a-a579883d8001`。新正式进程 PID 67410，端口 4173。沿用已验证冻结 Web build `a63675d2d41e0dc50732c897e926d6dfd681867403599a3efd4cdeb03f237b84`，未部署其他工作流的新前端资源。
- Chrome 正式页面重新加载，人工检查截图：已有 Codex 私聊历史完整显示，消息输入框可用。此项验证正式服务及页面恢复；本次记忆刷新行为由上述隔离真实 CLI 门禁验证，不冒充正式环境新一轮对话验收。

未提交或推送。Kimi/OpenCode 的记忆传输以及 busy 追加消息处理后只读 follow-up 的消除，仍未由本批解决。
