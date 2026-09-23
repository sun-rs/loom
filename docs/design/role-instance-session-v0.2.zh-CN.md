# Role/Session v0.2：验证后的合同增补与施工顺序

日期：2026-09-22。状态：待评审、未实施。本文增补 [v0.1](role-instance-session-v0.1.zh-CN.md)，未列出的已确认决定继续有效；发生冲突时以本文为新设计解释，现行产品合同仍不自动改变。依据：[第一批技术验证](../audits/2026-09-22-role-session-validation.zh-CN.md)。

后续施工主文档：[2026-09-23 重构施工设计](role-instance-refactor-execution-plan.zh-CN.md)。本稿保留技术增补依据；具体批次、迁移及切换门槛以施工主文档为准。

## 已确认产品选择

普通私聊只使用私有 box，复用原实例 session，排队且不 Guide 频道工作。Side 可以读已授权记忆，但禁止创建、修改、删除记忆及通过后台途径间接写入；不能用普通成员 override 放开写入。Side 工作文件默认只读仍为建议，不把记忆禁写扩大解释为用户已确认所有文件禁写。

## 必须补充的接口合同

### A. Session 身份独立于配置版本

RuntimeBinding 以 instanceId + bindingEpoch 寻址，native ID、Provider 身份和 lineage 持久保存。Role 配置版本、model、effort 是单独的期望/实际参数，不作为正常续聊查找键。模型切换完成后的验收必须检查 native ID 和早期细节，而不只检查 argv。

原生不支持同 session 切换时返回明确失败，保留原绑定；不新建、不回退默认。运行中切换在安全边界应用，具体 Provider 是否允许当前 turn 改档按能力处理。

### B. Fork 统一产品语义、保留原生差异

统一请求表达“复制到已完成 checkpoint，包含该 checkpoint”，不对上层暴露混杂的 messageID/turnIndex 参数。Adapter 将 checkpoint 映射到原生参数，并返回实际截止点和新的 native ID；checkpoint 过期/不存在/进行中必须失败，不能退化为全历史复制。

Kimi 的 active turn 拒绝必须显示为“等待安全分叉点”，不能取消主工作来伪装即时 Side。OpenCode 的排除式 messageID 参数由 adapter 转译；末尾截止、没有下一条消息及忙时竞态需专门测试。Codex ephemeral 与 Claude 持久 fork 等差异要记录持久性，不能用同一布尔 supportsFork 表达全部能力。

能力至少包含：持久 fork、临时分支、忙时分叉、截止点选择、恢复、model/effort 保持 session、Guide，以及权限执行能力。证据附 CLI 版本、接入协议和最后验证结果；源码存在不等于已发布能力。

### C. 分叉身份安全是后端合同

上下文复制不复制有效业务身份。平台凭据不得以长期可复用明文留在 prompt/transcript。fork child 只拿新 run/epoch 凭据；父实例仍在执行时不能为保护 child 而全局撤销父实例的合法 token。凭据需要绑定实际受控执行边界，防止 child 重放上下文里父 token。

如果同 UID/full-access child 可以直接读父凭据文件或复用父通信端点，仅替换环境变量仍不够。必须验证文件隔离及 IPC 端点身份，未满足时不得宣称 fork 的权限隔离通过。初始化中失败的新 native session 作为 orphan 回收，不能先加入有效成员列表再补认证。

### D. Side 禁写不能只靠 Role prompt

当前 full_access 标准路径不满足要求。建议新增独立、可验证的 Side 执行策略，不全局降低普通成员工具权限。平台记忆服务拒绝写，原始存储无可写映射，Provider 原生自动记忆的写入目录/后台执行同样受限。

macOS 沙箱基础实验可读禁写通过，但还需验证：已运行的本地服务是否在沙箱之外代写、子进程继承、预打开文件描述符、网络/IPC 代理、Provider session 元数据的必要写入、认证和用户配置读取。不能直接将临时实验 profile 作为生产安全策略。

若某 CLI 不能保证该边界，Side 明确不可用；不以提示词替代禁写。普通实例仍按已有配置运行。

### E. 私聊访问与调度目标绑定

公共频道执行期间，不授予尚未调度的私聊 box 读取/发帖能力。私聊轮次开始后授予该 target；回复必须带 target 身份且幂等。可共享 session 上下文，但业务权限不因模型记得旧 target 就永久保留。

target 权限由 Kernel/application-service 验证；AgentHost 只下发本次授权。保留现行公共历史读取合同，不能用全局“仅能读当前 Room”粗暴替代。转入下一目标时撤销旧执行权限， late result 不得串发。

## 分包与退出条件

| 顺序 | 工作包                                 | Owner                           | 完成条件                                                        |
| ---- | -------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| 1    | 身份、绑定与能力协议 ADR，假运行器测试 | protocol / Kernel / AgentHost   | 两频道独立实例；同实例恢复/改档不换 session；旧 epoch 写入被拒  |
| 2    | Side 权限与 fork checkpoint 非模型原型 | AgentHost / application-service | 临时环境证明身份及禁写；每家不支持项准确报告                    |
| 3    | 私有 box 和统一实例调度                | Kernel / application-service    | 私聊忙时不可提前读、按序回复、频道 Guide 不串目标、重启不漏交付 |
| 4    | 原生 fork/恢复/Side 逐家接入           | AgentHost                       | checkpoint、身份、持久性、失败回收真实验证；不静默重建          |
| 5    | 平台记忆存储、授权和版本               | Kernel / AgentHost              | 读写权限、并发冲突、撤销、来源与索引正确；不公开旧私有记忆      |
| 6    | UI、旧数据迁移与发布门禁               | client / Web / daemon           | 旧作者与任务不丢失，能力状态准确，迁移无双消费者，可恢复        |

测试先行。当前仅执行了既有 48 项回归和临时特征实验，以上新合同测试尚待实现。真实 CLI 验收需要后续明确授权，按允许的模型档位执行；没有真实上下文/质量和 token 对照就不宣称架构性能胜出。

## 仍待技术验证，非产品偏好问题

四家 checkpoint 分叉和身份初始化；本机模型/effort 切换的完整 session 链；Side 原生自动记忆与后台写入隔离；运行目标级私聊权限；混合旧历史迁移。现阶段无需追加一轮抽象 grill，但不得跳过这些门槛直接启用正式迁移。
