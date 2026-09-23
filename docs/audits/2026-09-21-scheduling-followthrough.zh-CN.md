# 调度修复后的正式续聊、Raft 对照与剩余边界

承接[第一批实施](2026-09-21-scheduling-repair-implementation.zh-CN.md)。本轮在用户授权下，
使用正式 RAH 既有 Claude/Codex Agent 与 Raft 对应 Agent，进行同题真实 CLI 对照。
没有清空记忆、历史或主动重置 Provider session，没有运行 Fable/GPT6，没有提交或推送。
本轮新增的是验证证据、下一阶段设计和遗漏的 parity 路由登记；未改变运行调度实现。

## 测量口径

Claude 两侧为 Sonnet 5/low，Codex 两侧为 gpt-5.6-luna/low。使用私聊隔离接收人，
避免 Speed_test 四家同时唤醒。C1/D1 为 17+26，C2/D2 要求复述上一轮答案。
既有身份、Room 历史和记忆均保留；但 RAH 第一批固定提示词升级会按既有 digest 机制
选择新原生会话。因此这是当前真实产品同题对照，**不是相同历史/缓存的严格 A/B**。
第二轮在各自同一原生会话继续，答案均正确。

RAH 时间从 Human 消息数据库提交到 Agent 消息提交。Raft 无中央数据库权限，时间从
浏览器发送动作完成到原生发送工具返回成功。两者终点不同；小样本不能给出精确速度排名。
原生 usage 的 input 包含缓存输入，不等于新增输入、计费 token 或每次重发了全部历史。
只提取 usage、工具边界和本轮测试消息，不提取内部思考。

| Provider | RAH 首轮 / 续轮    | Raft 首轮 / 续轮（近似） | 普通回复工具链                   |
| -------- | ------------------ | ------------------------ | -------------------------------- |
| Claude   | 9.349 / 8.060 秒   | 12.408 / 7.506 秒        | 两侧均 check → post/send → final |
| Codex    | 16.304 / 14.990 秒 | 15.110 / 12.453 秒       | 两侧均 check → post/send → final |

两侧普通轮次都是发帖前两次已完成原生模型响应，连同收尾共三次。此前隔离 Luna 的第三次
发帖前响应，是模型在工具中错误使用 `process.cwd()` 后重试，不是额外 Activation。
**不能继续把“Raft 普通消息总是一次生成发帖”当作基准，也不能承诺固定 6–8 秒。**

源码依据：@raft/computer 1.0.18 main.js，SHA-256
`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，
765187–765238 区分普通 content-free notice 与 Thread/resume concrete context；
本机 runner.log 此次也记录 `Delivering idle inbox update`。
上游发布包仅供分析，本轮没有复制代码或改变许可证边界。

## 剩余差异一：每轮重新 startup 造成持续输入增长

第二轮，从生成 check 到生成 post 的 input 增量：

| Provider |   RAH | Raft |
| -------- | ----: | ---: |
| Claude   | 4,754 |  238 |
| Codex    | 1,723 |  193 |

增量包含工具结果和工具调用等，不是单独 MEMORY 的精确计费值。RAH Claude 第二轮
startup 输出为 6,368 UTF-8 bytes，其中完整 MEMORY 索引约 5 KB；仍有身份/冻结范围
和正常 delivery。技术 audit 已不再是这轮主要新增内容。

RAH 每个 Activation 恢复原生会话，同时重新走 `message-check --startup`；Raft 此次
从空闲运行器接收新通知，未再次注入 startup 索引。因此应修正“常驻只省不到一秒”
这一过强判断：启动耗时很小，但**启动语义重复**还会增加历史、模型输入与缓存压力。
这不意味着可以直接删除完整 MEMORY 读取，或仅缓存一个“读过”标志。

## 剩余差异二：答完追加问题后仍有只读 follow-up

B5/B6 是两个明确不相互撤销的问题，要求分别回答 43 和 68。

- RAH B5 提交 06:06:07.512Z；B6 提交 06:06:17.182Z，确在第一 Run 期间。
- 第一 Run 在 06:06:35.633Z 一次发帖包含 `B5 43` 和 `B6 68`。
- 第一 Run 经 freshness hold 后再次 post，原问题未被覆盖。
- 随后仍启动第二 Run：06:06:38.831–06:06:54.537Z，耗时 15.706 秒。
  它只做一次 startup check，无新发帖；额外两次模型响应，input 分别 42,216/44,012。
- Raft 同样遇到新消息/发送 hold，再次 send 后显示两条答案；截至随后观察，没有新增
  check/模型响应。其中央队列不可见，不能将本机观察当作完整服务端证明。
- B3/B4 实际没有时间重叠，只能算连续普通消息，不能用于忙时验收。

这次没有漏答，但精确展示去重尚不等于消除所有冗余执行。不能从发帖文本自动猜“全部
请求已回答”，也不能把读过、Host 已写入、exit0 当成取消后续义务的充分证据。

## 下一阶段设计与单一 owner

分两条独立改造，禁止借优化突破现有授权/恢复合同：

1. **持续运行与启动语义**：AgentHost 负责原生运行器/会话生命周期；Kernel 仍逐次
   创建 Activation/RunAttempt 和冻结授权。优先复核已有 activation-environment-lease 与原生 Driver owner，不能另建调度队列。
   现有 resident-runner 管的是 Computer runner，不等于已经实现 Provider 跨 Activation 常驻。旧 Run 撤权、全部旧工具结束、
   下一 Run 激活之间必须有可测试的代际切换；不能将旧进程环境直接沿用到新 Room。
   首次/新会话/压缩恢复/记忆更新继续取得完整原始 MEMORY；正常 idle 输入与 startup
   分开。哪些原生驱动能可靠报告这些边界，应分别验证，不能四家一刀切。
2. **已处理追加消息闭合**：Kernel 内把精确读取、业务发帖和剩余义务关联起来。
   当前 post 没有精确“回应哪些 Human 请求”的合同，`basedOnRoomSeq` 只表示因果范围，
   不表示范围内所有请求都答完。先设计可验证的显式处理收据，再决定是否需要 Protocol
   扩展；不能先按最大序号取消 queued Activation。Task 改派/取消、审批和未答请求继续
   独立保留。原生 transcript 不能成为权威完成证明。

实施前的失败用例应覆盖：读两题只答一题、跨目标读取、已发帖后崩溃、发帖失败、重复
请求/ACK 丢失、新 Task 事实、旧工具跨代迟到、内存/会话重建、记忆变更、Stop 重发。
先将这些合同与现有恢复测试连接，再实现最小改动；本轮没有把该设计伪装成已落地能力。

## 检查与证据

- 49 项已有恢复/hold/第二 Activation/忙时通知/进程恢复测试通过，无付费假适配器混入
  正式测量。它们是确定性恢复证据，不等于所有四家真实故障场景完成。
- 补登记既有 `/v1/worker/message-present` parity surface，注明它是受限可选分支，
  不宣称普通生产 wake 已接线；34 项 parity 检查通过。
- 正式界面实际显示两侧 C/D 普通回复及 B5/B6 两题答案。
- 本轮未更换生产资产或调度代码，因此继续使用上一批已验收的正式实例，不为文档变更
  重启服务。其状态与活跃工作另在交付时读取确认。

[RAH 正式明细](../evidence/2026-09-21-scheduling-preparation/followthrough-formal.json)
和[Raft 原生元数据](../evidence/2026-09-21-scheduling-preparation/followthrough-raft.json)
记录本轮实际采样、会话 hash、工具与 usage。未完成项仍包括跨 Activation 运行器改造、
可靠已处理义务闭合、全部 Provider 恢复实测与等历史/等缓存延迟分布测试。

## 本轮收尾检查

`npm run check` 已实际运行：parity 34 项与 typecheck 通过；全量单元测试 1790 项，
1771 通过、2 失败、17 跳过，之后的 Web unit 等串联步骤未执行。两项失败仍为
既有 RoomKernel 源码大小门禁和 interaction-icons 冻结哈希，不放宽它们来制造绿色。
`npm run format:check` 报 12 个存量文件；本轮新增/修改文档与证据的独立格式检查通过。
`git diff --check` 通过。正式 health 为 online，buildId 仍为 `1aac55a094588f20`，
查询未结束 Run 为 0，真实浏览器已显示 B5/B6 回答。
