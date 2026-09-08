# 八组后端差异：证据与施工顺序

2026-09-08。用户要求以 Raft Computer 源码及官方行为为依据补缺。
本清单针对当前 `rah_os`，不是旧 `rah`，也不是此前内部反例 A1–A8 的重做计划。
已完成的 assign/unassign/convert、历史读取、消息附件、Search Human 入口保留回归。

上一批第 1、8 项后端实现、测试与正式重启已完成，详见
[收口记录](../audits/2026-09-08-task-amend-upload-capabilities.zh-CN.md)。
本轮直接依据已确认的源码能力合同实施第 2–7 项；实现、独立审查、正式运行验证分别记录，
不重新要求全部官网实验，也不把源码接口存在等同于未知中央 Server 的全部内部语义。
本轮状态见[六组差异实施与验收记录](../audits/2026-09-08-backend-six-gap-closure.zh-CN.md)。

## 证据判定

来源为 Raft Computer 1.0.18 的 `agentApiContract.ts`、发布的 daemon prompt，
以及已冻结官方 Web `index-BVfbaScj.js`。版本与 hash 见
[两轨审查](../audits/2026-09-08-two-track-parity-and-mcp-retirement.zh-CN.md)
链接的外部 `upstream-sources.json`。
源码存在接口足以确认能力差异，但不能证明未知 Server 的全部权限、删除副作用或排序算法。
本轮官方浏览器确认了 Task 的五种状态菜单；没有执行删除，也没有实测 Agent amend 权限。

| 用户编号 | 差异及证据                                                                                                         | 实施归属与退出条件                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Task amend：合同 416–427、1703；prompt 2659；官方 TaskModalHead 的 amended 使用 `changes[field].from/to`           | Kernel 唯一修改事务，Human/Worker 共用；标题/说明/清空、当前可发言成员、因果冲突、精确幂等、完整有界历史。不能通过改源 Message 代替。                                                 |
| 2        | Task delete：合同 1683–1691，独立于 closed；官方 Web 删除 reducer 移除卡片和消息的 Task 元数据                     | 依据明确的删除能力实施 Task 投影删除；讨论/文件保留、执行中拒绝等本地适配明确记差异。不能由前端过滤模拟删除，不能推断上游物理删库。                                                   |
| 3        | Agent 本频道静音：合同 1513/1523；prompt 2611 明确普通频道 Activity 静音，个人 mention/DM 穿透、follow Thread 独立 | Kernel Agent×Room attention 偏好；在已有投递派生处过滤普通 Activity。覆盖 mention、DM、follow、任务个人提及、取消静音及重启，不改变 Human 偏好或 Agent 运行开关。                     |
| 5、6     | 搜索字段和目标范围：合同 231–241 及 history/members/taskList/resolveChannel；prompt 2567–2570、2620                | 先统一 Worker 目标解析与当前 membership 授权，再接跨已加入 Room/DM 的读接口与 search 参数。读快照不得冒充 Activation 已读；跨目标写入须有目标 Room 因果凭据，不能篡改当前 Run grant。 |
| 7        | profile/serverInfo：合同 481–532、607–642；prompt 2506/2509/2511                                                   | 从现有 identity、runtime registry、Computer observation 投影公开字段；明确配置值与本次运行值，排除秘密和私有记忆。presence 不能由 enabled/PATH 推导。                                 |
| 4        | 附件评论：合同 276–331、2079，包含 anchor/reactions/resolved/viewer                                                | 从冻结官方 bundle 确认评论和 anchor 参数；由 RoomFiles 与已有消息/回应 owner 组合，未知解决/重开规则不猜测。不能新建与 Room 无关的评论聊天账本，也不能仅返回空列表宣称实现。          |
| 8        | 上传 capabilities：attachmentUploadContract 37–44、API 2019；已有上传本体                                          | Worker 只读入口复用实际大小上限与预约时长，直传未支持则如实 false/null。HTTP/CLI 输出与实际预约边界一致，查询不推进 ACK。                                                             |

## 执行依赖与本批边界

1. 第 1、8 项保留回归，不重做。
2. 第 2 项共用 Task 删除 owner；删除编号、引用、执行围栏和重放必须先通过反例。
3. 第 3 项只在现有 attention 派生前过滤，不另造调度器。
4. 第 6 项目标解析先于第 5 项全已加入 Room 搜索；跨目标写必须先实际取得目标上下文，不能篡改原 Activation grant。
5. 第 7 项投影已有身份、配置与真实运行观测；第 4 项保留 canonical Message/Thread 和显式附件目标，防止嵌套 Thread 或同线程附件评论混淆。
6. 并行实现后交叉反证，再由根统一检查、备份和正式重启。协议能力、CLI 真调用、页面交互和官网同条件实操是不同验收层。

每项退出均要求：源证据、失败测试、通过测试、对应 HTTP/CLI 真结果、重启后持久结果及明确剩余项。
浏览器只有实际操作过的行为才记通过；新 Worker 能力的确定性 CLI 测试不能冒充真实付费模型测试。
完成修复批次后由一个负责人执行规定检查，备份并优雅重启正式实例，验证真实页面与冻结资产。
不提交、不推送、不恢复 Managed MCP；多 Human、远程 Computer、大文件流式和云订阅继续在当前范围之外。
