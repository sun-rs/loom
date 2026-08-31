# Raft Agent surface 桌面/PWA 证据审计

日期：2026-08-28

## 1. 证据边界

本审计使用：

- `/Users/sun/Code/repos/raft_snapshot` 中四张 5120px 桌面截图与五张 1279px iPhone 截图；
- 已冻结的 Raft Web build `666bab60d8658d9e382e2c286ce1e423231e8f31`；
- `index-WTraJnrd.js`（SHA-256 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`）中的官方中英文 message contract；
- `index-EQxYM8hQ.css`（SHA-256 `36d9e3d1cb74dd7638c87f7544042c77da547302a0e98112d95ad702be91d3d6`）与已经生成的 Members computed-style contract；
- RAH_OS 隔离 Fake Runtime 工作台在桌面与 390×844 视口的真实浏览器检查。

截图只能证明可见结构和当时状态，不能证明服务端业务语义。bundle 中的文案和 CSS 可以证明官方客户端合同，但没有公开源码或服务端证据的行为仍不能宣称为 Raft Server 源码。

## 2. 官方信息架构

Agent 是 Workspace 级长期身份，不是当前 Room 的临时成员行。桌面和移动端共享同一详情协议：

1. 动态：按时间排列的 runtime/tool/message/file-change/idle 诊断轨迹，并提供复制诊断信息；
2. 资料：身份、在线态、角色、Computer、创建信息、Runtime/模型/推理/模式、环境变量、子 Agent、Skill 与生命周期操作；
3. 聊天：Agent 可读取/参与的频道，以及 Agent-to-Agent 私信活动；
4. 提醒：该 Agent 的待触发提醒；
5. 工作区：Agent workspace 文件树、源码/预览切换和文件内容；
6. 应用：该 Agent 可使用的连接应用；
7. MCP：该 Agent 的 MCP 使用记录。

桌面壳为 `64px rail + 320px Members sidebar + fluid detail`。移动端不是另一套页面：先显示成员列表，进入 Agent 后使用 76px 身份头、可横向滚动的同序七标签与单列内容；详情打开时底部全局导航让位，返回键恢复成员列表。

## 3. RAH_OS 当前裁决

| 模块                                                  | 当前状态                                                 | 裁决                                                               |
| ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| 全局壳、成员边栏、头像、七标签、移动 list/detail/back | 已接入并进入 Chrome/Firefox 门禁                         | 保留单一 `AgentDirectoryPane` owner                                |
| 资料 identity/runtime/Skill                           | canonical 数据已接入，环境变量与部分生命周期动作尚不完整 | 继续扩展 typed read/command，不在 UI 伪造                          |
| 聊天频道目录                                          | typed `agent.room.list` 已接入                           | 只显示当前 Human 与 Agent 的共同 canonical Room，点击打开真实 Room |
| Agent-to-Agent 私信                                   | 未形成独立活动模型                                       | 保留官方空态；不能把普通共同 Room 冒充 Agent 私信历史              |
| 动态                                                  | typed `agent.trajectory.list` 已接入                     | Codex/Kimi 结构化轨迹独立持久化；不解析 stdout/ANSI                |
| 提醒                                                  | 未实现                                                   | 等 Kernel owner 和 typed protocol                                  |
| 工作区                                                | 未实现                                                   | 等安全文件树/读取协议，不能把浏览器文件访问或 CLI stdout 当真相    |
| 应用                                                  | 未实现                                                   | 等连接目录、授权和 secret owner                                    |
| MCP                                                   | version-fenced usage projection 已接入                   | 保持参数、凭据和结果正文不进入浏览器                               |

## 4. 本轮发现并修复

- 旧“聊天”tab 只是不可用占位，与官方截图和 bundle 合同明显不符；现已增加 Kernel → Human port → HTTP → typed client → React 的完整 `agent.room.list` 路径。
- 列表权限不是前端过滤：Kernel 验证 Human 能读取 Agent control Room，并只返回双方都有 membership 的同 Workspace 非 control Room。
- Chat tab 已改为官方“频道和私信 / 频道 / Agent 私信”信息结构、官方文案、加载/错误/空态和真实 Room 跳转。
- 桌面与 390×844 均验证无 document 横向溢出；移动详情仍使用同一组件树和横向 tab strip。
- `RoomKernel` 新能力没有通过提高 source ratchet 容量绕过架构约束；SQLite row projection 继续由独立 owner 负责。
- “动态”已从业务 activity read model 切换为 Kernel-owned runtime trajectory：Codex app-server turn/item notification 与 Kimi ACP `session/update` 经单一归一化 owner、专用 fd3、严格 schema、RunAttempt/RuntimeRun identity 和 producer/server sequence 持久化。Agent 页首屏最新 50 条、正序显示、2 秒合并、500 条活跃窗口，并提供更早游标。
- `beforeActivityId` 是经服务端重新验证 scope 的 opaque continuation；Human 不再具有某个实际 Room membership 后，该 Room 的 trajectory 与 cursor 都 fail closed。Codex 原始 chain-of-thought、Provider stdout/ANSI 不进入轨迹；安全诊断复制进一步排除 thinking/text/tool input/result 正文。
- Managed MCP 条目使用调用时被冻结的 Server config revision 解析服务器名称，区分 pending/completed/tool-error/failed/timeout；不会把后续 Server 改名错误地回写到历史。
- React 只调用 `agent.trajectory.list` 并呈现 discriminated typed record，不再从 `roomData.agentActivity` 或业务审计组装 Agent 历史；桌面与 PWA 复用同一时间线组件、加载/错误/空态与“加载更早记录”。
- “复制诊断信息”已成为真实浏览器动作：只对白名单 typed metadata 做逐字段输出，最多 200 条、64 KiB，不序列化未知 payload、调用参数、凭据或结果；Chrome 门禁覆盖点击与完成反馈。

## 5. 尚未收口的高优先级差异

1. Agent activity 已有 canonical 跨 Room 时间线和 Managed MCP 工具调用，但仍不等同于 Raft 的逐条 Provider-native tool/file 诊断历史；RAH_OS 只会在形成独立、redacted、typed diagnostic evidence owner 后补充这些条目，不会把 transcript/stdio 升格为 Room 真相。
2. Profile 仍缺少后端治理的环境变量 read/write、显式 restart/session reset 与完整运行环境诊断导出；当前复制能力只覆盖已加载的安全 activity metadata。
3. Workspace、Reminders、Apps 与 Agent-to-Agent DM activity 仍是 capability 空态。
4. `Room` 当前没有 public/private/joint 可见性字段，因此 UI 不得凭 `kind=channel` 猜测“私有”徽标；补齐可见性必须先改变 protocol/Kernel owner。
5. 截图覆盖了关键 Agent tab，但不覆盖所有 hover、focus、menu、loading、permission-denied、migration 与 destructive-confirmation 状态；这些需要继续从 live DOM/computed style 和真实交互提取。

结论：此前把 Agents 页评价为“已完全复刻”是不成立的。现在 Shell、Profile 主结构、共同 Room 聊天目录、统一的 canonical event/Managed MCP activity history、安全诊断复制与 MCP usage 已走真实协议，但 Provider-native 诊断、Profile 操作、Workspace/Reminders/Apps/DM 仍是部分 parity；下一轮应优先补后端治理能力，而不是继续堆静态页面。
