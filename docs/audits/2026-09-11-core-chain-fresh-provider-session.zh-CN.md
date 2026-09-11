# 真正新Provider会话的核心链补验

使用主线程增强后的 `packages/daemon/test/real-core-chain-gate.test.ts`，本次不是重跑旧的“新RunAttempt即新会话”版本。测试文件SHA256为 `cae16e08d283dbe901f21e9e076affe97dbbf1475240c910f6595fcaa1aa4953`；产品基于ac0f486工作树。本次只运行隔离门禁，不修改产品或正式实例。

命令环境为 `RAH_CORE_CHAIN_GATE=1 RAH_REAL_GATE_KEEP=1`，保留默认35分钟预算，不失败自动重试。日志 `/Users/sun/Code/reviews/rah_os/2026-09-11-busy-latency/core-chain-fresh-session.log`；现场 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-core-chain-m5HBvq`。

与旧样本相比新增的必要证明：

1. 记忆更正后，经Human正式execution/reset接口执行mode=session。
2. 重置回执确实隔离至少一条provider continuity记录，且私有记忆文件内容不变；活跃continuity为空。
3. 下一次跨Room提问生成的真实provider sessionId与重置前不同，而非只新增RunAttempt。
4. 新会话回复确实包含更正值，而不只记录一个observed布尔值。

继续复用跨Room成员范围、DM配对、私有记忆负对照、实际model/effort切换以及有序daemon重启恢复的已有门禁。仍不是浏览器断线或进程崩溃的证明；官网双Thread可能与本轮模型执行重叠，因此本轮只做功能验收，不用于双方速度基准。

模型必须精确命中既有授权绑定，禁止fallback。原运行最终失败；独立新会话 checkpoint 随后通过，见下文。原日志与现场保留。

## 执行中发现的既有负对照缺陷

主线程指出后已核实：门禁431–435先将三Agent都加入Room A；648的S5事实随后明文发布到Room A。实际mem-b加入时间00:43:28.530，S5 Human消息00:43:28.542，mem-b合法可读该Room历史，不能说它从未获得该事实。CCG5/6又在同一Human消息中要求mem-a公开S3私聊口令，同时要求mem-b做负对照，存在竞态污染。

本次不修改运行中的测试。如果mem-b回答或保存该值，必须先排除其读取公开Room消息的合法来源，不得直接称私有文件泄露；如果断言通过，也只说明该次未转述，不能宣布严格盲负对照通过。修正实验应把事实先放仅mem-a可访问的DM，并先在独立DM询问mem-b，再把值公开到共享Room；同时独立验证私有文件访问边界。此问题不改变真实session reset的判据，但若门禁提前因此失败，后面的reset场景就仍未运行。

## 原始运行结果与独立 checkpoint

原门禁在约 614 秒后失败，19 个 Activation 均已 completed。失败点是断言 mem-b 的 MEMORY.md 不含 ORIOLE-1：该值事实上是它已加入 Room A 后 Human 发布的可读事实；mem-b 将其明确记录为 Room 中告知 mem-a 的历史观察。此次失败不能证明私有记忆泄露。原始门禁仍保持 failed，CCG7、真实 session reset、CCG8、配置切换和服务重启均未到达。

用户要求继续未执行环节，因此新增独立 `packages/daemon/test/real-core-chain-checkpoint-gate.test.ts`，复用 m5HBvq 已空闲状态，启动前后断言 Agent revision 未变化，并检查精确授权 model/effort 与当前 catalog；不重建角色、不重发前六轮。只继续 CCG7 更正 → Human session reset → 实际 provider ID 更新且私有文件保留 → Room B 与 DM 召回。该补验不把原门禁改判通过，也不承担负对照结论。日志在同证据目录 `checkpoint-fresh-session.log`，结果保存现场 `checkpoint-evidence.json`。该 checkpoint 随后通过；配置切换和重启另见独立续验报告。

### 新会话实际读取来源（已取得）

01:02:23.786Z，Human session reset 回执隔离一条 continuity。旧 Kimi session `session_e46a2d11-b524-41ec-913e-7255b63954c7` 更换为 `session_cec2f8cb-0b0e-4b09-95ca-aed08afa9dd4`，实际 llm.request 为 `kimi-code/k3`、`thinkingEffort=high`。新会话 Read 自己的 MEMORY.md 与 notes/project-codenames.md，工具返回都含 ORIOLE-2；同阶段 worker sync 与 message-resolve 不含该值，发送前没有跨 Room room-read。工具事实能证明读取，不只是模型自称读过；该事实历史上公开可访问，仍不能由本用例证明不可跨 Agent 读取。

Room B 在 01:06:49.937Z 成功发布 `message_987dca6c-9762-4781-9a68-7488d2d20517`，回复当前值 ORIOLE-2 并指出 ORIOLE-1 作废。首次发送先 hold，窗口包括本次 CCG8 与两条历史 Room B 消息，send-draft 随后成功。独立证据为 `checkpoint-memory-tool-evidence.json`；不含 thinking。Room B 闭环已通过，随后 DM 验证正在执行。

### Checkpoint 最终结果

独立补验通过，运行 683 秒，exit 0，daemon 有序退出。DM 成功消息为 `message_2636ee51-dbef-4336-828e-973aee4ba534`，01:10:14.638Z；同新 session 再读 MEMORY.md，首发因本次 Human 提问触发 hold，send-draft 成功。完整结果为现场 `checkpoint-evidence.json`。这次关闭了更正、真实新 provider 会话、私有文件实际读取、跨 Room/DM 回读；没有改判之前失败的完整门禁，没有冒称盲负对照通过。

原场景4的配置切换与有序重启抽为独立 `real-core-switch-checkpoint-gate.test.ts`，保留既有测试步骤与实际 driver argv 断言，追加原请求与独立追加问题都必须有业务回复的断言；仅复用已有角色，不重放初始记忆场景。该独立续验随后执行并 exit 1，发现审计回复串到旧 Room；详见 `2026-09-11-runtime-switch-checkpoint.zh-CN.md`，不计为整体通过。
