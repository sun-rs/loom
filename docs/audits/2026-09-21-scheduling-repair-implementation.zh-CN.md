# 调度修复：业务投影、启动上下文与精确展示记录

承接[修订顺序](2026-09-21-scheduling-repair-raft-review.zh-CN.md)，基线为
`2a31ec2`。本批修复生产代码，不重写四家 Driver，不把 Provider 会话改为按 Room
分裂，不删除历史会话，不取消仅因已读而仍有执行义务的 Activation。

## 源码依据与边界

分析参考本地留存 @raft/computer 1.0.18 `main.js`，SHA-256
`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。
check/drainInbox 在 729502/677012；recordConsumed/shouldSuppress 在
762810/762860；连续推进限制在 744712；普通通知、Thread join、resume catchup
分流在 765187–765238。发布包仅作分析证据，本批为行为适配及 RAH glue，非逐字复制。
Raft 中央服务全实现不可见，不宣称本地比它更好。

## 实施

| 修订顺序       | 本批结果                                                                                                                              | 单一 owner                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 投影与确认合同 | 普通 message-check 排除明确枚举的 execution audit；业务事实、未知事件、原始账本和扫描游标保留；内部空页可排完，输出失败仍不能确认正文 | Kernel 投影，application-service 接线      |
| 启动精简       | startup 校验完整 manifest，但只返回身份与执行范围；角色已在固定指令中，不重复序列化 AgentDefinition；完整原始 MEMORY.md 不截断        | AgentHost startup，daemon 固定指令         |
| 精确去重       | check ACK、history、room-read、held 记录实际返回的消息序号，按 Agent/Room/Thread 隔离；忙时通知和重复展示标注只认精确记录             | Kernel worker-message-presentations        |
| 保住原始请求   | 不再将最高已展示序号理解为此前全读；模型文字明确 high-water 不是连续边界。原始冻结窗口、重放、Task 义务继续保留                       | Kernel delivery-window，AgentHost renderer |
| 后续优化       | 不引入常驻进程、强制一轮生成、默认按 Room 换 session 或跳过 MEMORY                                                                    | 本批有意不做                               |

正式普通唤醒仍经 `providerActivationInput` → `message-check --startup`；
独立 `wake-message-input.ts` formatter 在当前树没有生产调用点，不能因文件存在就
声称已启用首次正文直送。本批未将普通唤醒强制改为该分支。已有消息列上下文、
原始窗口重放与忙时追加链条继续由原 owner 处理；测试覆盖其保留行为。

`worker_message_presentations` 是精确展示事实，不是另一条队列、ACK、已回答证明或
Task 完成状态。schema 57 → 58 新建空表，不从历史最大序号猜测回填；旧记录首次
可能多展示，但不能误吞消息。Room 删除清理该表。迁移前备份与迁移副本预检保留。
回退旧 schema 的二进制必须使用对应备份，不可让旧代码直接写 schema 58。

固定提示词内容变化会按现有 deterministicDigest 机制选择新的 Provider session key；
旧 session 文件不会删除。这是固定指令升级的既有机制，不是为了取得好看耗时而重置
正式 Agent。Agent 身份、角色、私有记忆及 Room 历史保持原 owner；新指令下连续两轮
会话复用已验。完整 MEMORY 在第二轮仍重新读取。

## 验证

- 新失败用例先复现：技术 audit 混入 check；只读最后一条却吞掉前面通知；固定指令要求重复 dump manifest；展示文字误称连续读过。修复后定向通过。
- 39 项调度链测试通过：分页/输出失败、重放、busy hold、第二 Activation、精确集合、schema 升级和未知业务事件保留。
- 97 项 renderer/固定指令/第二 Activation/通知测试通过；30 项固定指令/备份迁移测试通过（集合有重叠，不相加作覆盖率）。
- 全量 `npm test` 实际运行 1789 项：1769 通过、3 失败、17 跳过。迁移快照预期仍写 56 的失败已更新为 58 并单独复验通过；其余为基线已有 RoomKernel 7102 行超过 6925 门禁、UI 图标源码哈希不一致。本批未增加 Kernel 主文件行数，未放宽门禁或改写图标期望。
- `npm run check` 在基线已有 `/v1/worker/message-present` 未登记 parity surface 处停止；不能报告全量门禁绿色。独立 typecheck 和正式 Web 构建通过。
- 全仓 format 检查仍有基线和此前 scratch 文件格式问题；本批改动文件独立格式化并检查，`git diff --check` 通过。

## 真实 CLI 与效果边界

用户授权的隔离门禁：Claude `sonnet/low`、Codex `gpt-5.6-luna/low`，绑定不存在就失败，
禁止回退。两家各连续两轮，均一次 Run、一次回复，第二轮正确返回第一轮口令。

| Provider | 第一轮回复 | 第二轮回复 | 第一轮首响应输入 | 第二轮首响应输入 |
| -------- | ---------: | ---------: | ---------------: | ---------------: |
| Claude   |   9.793 秒 |   8.069 秒 |     40760 tokens |     44070 tokens |
| Codex    |  14.589 秒 |  11.535 秒 |     24020 tokens |     25176 tokens |

这是新隔离会话验证，不是正式旧会话同前提 A/B，更不是本批当前线上 Raft 双边验收。
回复前完成的原生模型响应仍有 2–3 次，不能声称已降到一次；Claude 首请求也未低于
3 万。完整数据见[真实 CLI 证据](../evidence/2026-09-21-scheduling-preparation/repair-real-cli.json)。
统计只读 usage 和工具边界，未将内部思考文本作为业务证据。

对已捕获 S1 输出离线应用同一枚举，Codex 从 15805 降至 3859 字符，Claude 从
17948 降至 6002 字符，两者各去除 11946 字符技术 audit。这是输出字符差，不是
实测 token 节省或延迟承诺，见[离线投影](../evidence/2026-09-21-scheduling-preparation/repair-offline-projection.json)。
新 Claude startup 工具输出分别 1456/1250 UTF-8 bytes。

仍保留必要 follow-up 执行，不能以展示替代完成；尚未证明所有同伴只读 Run 都可安全
消除。旧 Provider 会话已有历史不会因投影变小而从服务端自动删除。后续验收应在同模型、
同历史前提下继续观察新增输入、真实回复、busy 独立请求和恢复，不能只比较新旧总 token。

## 正式重启验收

已在无活动 Run、现存 4 个 queued 均被既有 SOS stop 围栏保持的状态下，由
`restart-local-workbench.mjs` 完成备份校验、迁移副本预检、SIGTERM 和新实例启动。
旧 PID 30749 → 38760，schema 58，正式 buildIdentity `1aac55a094588f20`，
Web 资产 `a63675d2d41e0dc50732c897e926d6dfd681867403599a3efd4cdeb03f237b84`。
备份为本机 `~/.rah/backups/pre-restart-7ade0ea5-e8bd-49db-8d0b-cfc823dbb938`。

新 Chrome 页面已实际加载 all 和 Speed_test：历史消息、原 S1/B1/B2 回复、5 位成员和
composer 可见，非仅 health 验证。此步骤没有在正式频道新增付费调用。
备份与新库逐项比对：217 条消息、15 个 Agent 定义、94 个定义版本、48 个成员关系、
13 个记忆 home 记录相同；355 个原记忆文件逐字节一致。
见[正式重启证据](../evidence/2026-09-21-scheduling-preparation/repair-formal-restart.json)。

交付时工作树另有并行产生的 Web 组件修改；本批没有编辑这些文件，正式实例使用上面
明确记录、已验证的冻结 Web 资产，不能据本次重启声称这些后来的 UI 改动也已部署。
没有提交或推送本批修改。
