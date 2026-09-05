# Room 长历史有界同步与可见回执审计

日期：2026-09-05

## 结论

本批关闭第三方复核中的长历史 P1：Human 浏览器冷开 Room 不再从 sequence 0 自动抓取并
常驻全部事件正文。daemon 返回“当前 snapshot + 最多 500 条尾部事件”，浏览器 Room 投影
最多保留 2,000 条事件，Room/Message/Thread session cache 各自最多保留 8 个活跃条目。

这不是简单截断。消息正文继续使用 Raft 的 50 条初始窗口和显式“加载更早”；Agent 引用
旁的已读/未读点改由 canonical Inbox 的 200-ID 有界查询提供。因此长历史优化不会把用户
此前要求保留的粉/灰回执语义或消息页面交互一起删掉。Worker 的 Activation 因果范围、
完整事件交付和精确 acknowledgement 没有使用 Human bootstrap 快捷路径。

本结论不扩大为全产品与 Raft 完全一致。Raft 同功能页面仍须逐批做相同前置的 UI、鼠标、
键盘、焦点和功能比较；本批只证明消息时间线及其相关注意力/回执没有视觉交互回退。

## 来源与边界

| 来源                                        | 用途                                                           | 本批采用                               |
| ------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Raft 真实页面、已冻结发布物与既有浏览器证据 | 50 条 Message 初始窗口、显式更早历史、消息注意力与回执外显合同 | 保留页面行为，不推断其中央服务端实现   |
| 第三方 10 万 Room event 隔离复现            | 证明旧客户端从零读取 200 页并持有全部正文                      | 转为有界 cold-bootstrap 反例和压力检查 |
| RAH Kernel / SQLite / typed SDK             | snapshot、ACL、Inbox receipt、分页、索引与本机长期运行         | 唯一 canonical owner                   |
| 外部 `raft-ui` 参考目录                     | 不参与运行时依赖                                               | 未作为官方源码或后端标准               |

当前没有可证明可直接复制的 Raft 官方服务端长历史实现；因此本批是按 Raft 外显合同，在
RAH 本地架构内实现确定性的 bounded read model，而不是伪称“复制 Raft 后端”。

## 实现审计

### Room 与浏览器内存边界

- 协议新增严格的 `bootstrap: "latest"`；它与 `afterSeq` 互斥，并要求成对的
  `eventFloorSeq` / `snapshotSeq`、非空当前 snapshot，且 snapshot 必须位于 latest Room
  sequence。
- Kernel 只允许 Human cold projection 使用最新 snapshot 与尾部窗口。普通增量读、丢失
  acknowledgement 后重放，以及 Worker 读取继续从精确 cursor 工作。
- `RoomProjection.historyComplete` 明确区分完整历史与有界历史；依赖完整 replay 的旧推断
  不得在 bounded projection 上冒充完整事实。
- Message 与 Thread 保留现有显式前向分页和 scroll-anchor owner；缓存淘汰只释放客户端对象，
  不清理 daemon 数据。

### 粉/灰回执语义

旧实现从浏览器持有的完整 Room event 推导 mention receipt。窗口化后若继续沿用，会把早期
消息的状态错误地变成未知。本批新增 `/v3/client/messages/reference-read-states`：

- 请求只接受同一 Room 中至多 200 个唯一 Message ID；
- Kernel 先验证当前 Human 仍是 Room member；
- 单次索引查询连接 `message.posted` 与 `inbox_items.reason='mention'`；
- Inbox `acknowledged` 投影为 read，其余已存在 mention item 投影为 unread；
- 前端只查询当前可见/已加载的 Message，Thread 使用相同 owner。

它把“是否读到”与 Agent 在线/思考、浏览器是否保留旧事件、Provider 日志完全分离。

### Task 与审阅读取

- Room Task 默认返回最新 200、最多 500；`beforeTaskNumber` 提供稳定向前 keyset。
- 当前页依赖和参与者各用一次批量查询，移除每 Task 两次读取。
- Room Review/Submission 只读取当前 Task 集合，默认 200、最多 500，并按最新证据的索引
  选择后恢复稳定业务顺序。
- schema 49 增加 `idx_room_events_message_aggregate`、
  `idx_task_submissions_room_created`、`idx_task_reviews_room_created`。

## TDD、压力与浏览器证据

先写失败合同后实现：协议最初无法导入 bounded receipt schema，Kernel 也没有对应读取；补齐
owner 后，协议、Kernel、HTTP 403 ACL、SDK route、客户端投影和 Web 组件测试通过。

受控的真实 SQLite 10 万事件检查（临时数据库，完成后删除）得到：

- 插入 100,000 条事件耗时约 740 ms，数据库约 89,673,728 bytes；
- cold bootstrap 返回 500 条，`eventFloorSeq=99,501`、`latestRoomSeq=100,001`、
  `snapshotSeq=100,001`；
- 同一进程测得同步约 2.8 ms、RSS 增量约 1,343,488 bytes；
- query plan 使用 `idx_room_events_sequence` 的 Room/sequence range search。

这些数字是本机一次可复现的受控运行，不是所有硬件的性能承诺；其意义是证明请求数和
返回量不再随 Room 年龄线性增长。

完整门禁结果：

- `npm run check`：核心 891 项中 889 通过、2 项显式跳过；Web 331 项、parity regression
  34 项、浏览器策略 8 项全部通过。
- Message timeline 真实 Chrome：10,050 条逻辑消息只渲染 27 个 DOM row；prepend 50 条后
  anchor delta 为 0；Markdown 连续 20 次刷新、富引用、粉色未读、黄色 mention、静音灰态、
  圆形工作状态在 1440×1000 与 390×844 均通过。
- 首次运行该门禁发现测试 fixture 仍从已迁移组件导入旧 context，导致页面没有挂载而不是
  业务断言失败；修正为内部统一 entity context 后，门禁通过。该失败被保留为验收工具自身
  也必须可运行的证据。
- 完整产品真实 Chrome 门禁通过，包含桌面/断点/390×844、Task 五态、消息、浮层与 typed
  交互组合。

## 正式重启与线上实例

- 正式地址：`http://127.0.0.1:4173`
- 新服务 PID：`35487`
- build ID：`9f47442faaab353c166f8ecae8ed83ac6e819df78b819dc01381b17860db00c2`
- 校验后的重启前备份：
  `/Users/sun/.rah/backups/pre-restart-61a8e21c-26c8-4262-aee9-16fb30baa76d`
- 正式 `room.db` 已为 schema 49；三个新索引存在，Task state/workflow 不一致计数为 0。
- 本机安装的 Chrome 直接访问重启后的正式 4173：新 build 元数据一致，现有 Room 与消息
  正常显示，没有 `JSON.parse`/`NetworkError` 文案、console error 或 4xx/5xx 响应；新的
  receipt endpoint 对当前 Room/可见 Message 返回 200。

macOS 在可见 Firefox 复核前再次锁屏，自动化无法接管窗口，因此本报告不虚构 Firefox
完成态。独立、干净 profile 的系统 Chrome 与正式实例检查已经完成；Firefox 可见窗口是
设备验收补项，不影响 protocol/Kernel 的有界性结论。

## 保留风险与下一批

1. Human 显式连续加载的 Message 历史会保留在当前 open session；未来若增加产品级上限，
   必须提供可见的重新加载策略，不能静默丢行。
2. Task API 已有 keyset，但页面尚未提供“更早 Task”的完整 Raft 对齐入口；当前看板只消费
   最新有界页。
3. Thread 目录、成员目录仍需在真实超大 Workspace 组合场景下单独建立规模边界。
4. 下一主批为冻结交付证据：repo/workspace identity、base/head、patch digest、附件和测试
   结果必须绑定同一 Submission revision，Reviewer 不得审查变化中的工作区。
5. 完整团队返工/验收闭环、剩余页面族双边对齐和 macOS/iOS 通知设备验收仍未因此完成。
