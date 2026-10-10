# Pi 普通 CLI 接入

本批把已安装 Pi 接入现有 Role / Instance / RunAttempt 路径，为五 CLI 成本对照补齐正式运行时。它不构成 Pi 成本验收；真实付费用量与批准组合仍以[运行台账](paid-runs.zh-CN.md)及 `scripts/cli-efficiency/approved-models.mjs` 为准。负责人于2026-10-10批准 Pi / aihubmix/deepseek-v4.1-flash / low；批准组合不等于已完成付费验收。当前 Pi 使用独立核验的 print-session 双臂测试包；旧通用 efficiency/business-long runner 尚不支持 Pi，仍在模型启动前拒绝，不能仅因批准表新增一行而隐式启用。

## 所有权与执行

- Protocol 登记 `pi-print-json/v1` 与 `pi-cli/v1`，拒绝交叉使用其它 CLI 的 catalog。Daemon 发现本机 `pi`，不安装 CLI，不修改账户。
- AgentHost 使用普通 `pi --print --mode json`，每轮启动进程，同一实例恢复同一个原生 session 文件与 session ID。文件是 CLI 自己的诊断会话，不是 Room 历史或平台记忆。实例 generation 参与文件定位，不能把旧 session 静默当作新一代。
- 复用现有 `GenericProcessAdapter`、`ProviderSessionStore`、进程监管和原 Worker 凭据；不增加调度队列、业务游标或另一份 Task 状态。Room 发表、ACK、stale 检查与幂等继续由原应用服务和 Kernel 负责。
- 这是每轮冷启动的窄接入，尚不支持热进程池。它不表示目标合同的热进程要求已经通过 Pi 验收。附加目录、启动参数覆盖、独立打包执行暂不可用，明确失败，不静默忽略。

## 输入、记忆与最终回复

Daemon 仍是 standing prompt 的唯一组装者。Pi 通过原生 append-system 参数接收它；固定多行前缀避免把文本误作一个本地文件路径。主唤醒正文通过 stdin 传递。真实 CLI 的免费检查确认续轮重新构建 system 层，因此每轮携带本次 Channel memory index 的序号，而不沿用上轮索引的传输证明。

不创建 `MEMORY.md`、`APPEND_SYSTEM.md` 等平台记忆文件。Pi 原生 session 可能保存已发送的 system 内容；关闭读取不会撤回这些历史诊断。CLI 原生上下文文件与用户工具配置不等于平台自动记忆；受控测试的资源隔离参数不作为生产默认策略。

默认沿用显式 Worker 发表。`LOOM_PI_NATIVE_FINAL_TRIAL=1` 才选择原生最终文本：Host 校验当前 session、当前追加分支、原始唤醒正文、模型与 effort、完整工具终态和原生成功终态，再通过原 `WorkerFinalOutput` 提交。CLI `exit 0` 本身不证明成功；中间文本、未结束工具、abort、retry、错误终态不能成为 native final。一次工具失败后恢复并正常结束可以交付。未知写入结果不重发；普通消息或进程退出不会完成 Task。

## 模型与用量证据

Catalog 使用离线、无 prompt 的只读 RPC，禁用探测阶段的扩展、MCP 等资源加载，查询 available models、当前 state 和当前模型的 thinking levels。只发布当前模型的精确绑定及原生报告的级别，不调用 `set_model`，不修改用户设置，也不根据 `reasoning: true` 猜测 effort。实际离线检查已识别 `local:pi-cli/v1:aihubmix/deepseek-v4.1-flash`；这是模型发现证据，不是付费批准。

每个已完成 assistant 响应的用量及时送入原 Host 用量通道，response ID 去重。输入合计为 Pi 报告的 input、cacheRead、cacheWrite 之和；output 使用原生报告值，缺少的 reasoning/context 指标保持未知。已知失败用量保留；重复 ID 冲突、截断或未完成后续响应标明缺口，不能以最后一条成功 usage 代表全程。报告 token 不等于账单金额。

原生 session 的整文件校验目前有 32 MiB 上限，超限明确停止而不自动换 session；压缩后的非线性分支、热运行、远程与独立打包、附加目录及长期成本仍需后续验证。自动化、实际 CLI 假模型、付费效率与正式部署分别记录在[现状页](status.zh-CN.md)，不能互相替代。

模型配置并发变更另有明确边界：Pi 原生 `--model` 先精确匹配，失败后可能模糊匹配相似名称。Host 校验 catalog 绑定与最终实际模型，但不能撤回已经发生的原生请求。成本门禁必须冻结模型配置身份、启动前检查精确 catalog、运行后复核；本接入不宣称配置漂移时也保证零次替代模型请求。离线合成 resolver 反例已保留，不通过增加提示词解决。

P181 真实长任务补充：共同前8对raw全消费input为原生2.258894倍、output为1.748458倍；输出预算止损，不能称完整12对验收。第8轮发生正常原生压缩，两个原始响应的82296input/3108output与原生compaction聚合一致，但当前driver只采assistant usage，Kernel未计入这笔量，也未主动标gap。这是产品用量覆盖缺陷；不得把聚合伪装成单个provider response补账。原始全消费核算已经包含这笔费用，压缩只解释该样本输入差额约2.67%，其余仍需沿业务轨迹与累积历史调查。[实测与限制](evidence/2026-10-10-five-cli-admission/pi-p181-review.json)。
