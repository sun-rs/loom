# 实例 Session 绑定合同：首批代码

日期：2026-09-22。范围：[ADR 0032](../adr/0032-instance-session-binding-contract.md) 的协议与纯规则基础，不是新架构正式上线。

## 已实现

- Protocol 严格校验实例、频道、Role 快照、Host、CLI、原生 session 和 epoch；模型/effort/配置版本不混入绑定身份。
- Kernel 纯规则检查完整 expected binding；替代保留实例、增加 epoch；fork 创建新实例与原生 ID，epoch 从 1 开始，Role 快照和频道保持。
- 拒绝陈旧请求、相同 ID 的伪 fork/替代、epoch 溢出及额外 task/token/lease 字段。

测试先写，首次两文件因目标模块缺失而失败；最小实现后 8 项通过。该结果只证明协议和纯规则，不证明真实模型切换后仍在同一上下文。

## 尚未接通

没有 Kernel 数据表/事务接入，没有 provider-session-store 改写，没有 Role 或实例创建入口。函数中的 current 必须将来来自可信事务；现在不能把它称为防止旧进程写入的完整 fence。native ID 跨实例唯一性、幂等回放、执行租约、恢复阶段和 fork orphan 清理仍待接入。

私有 box 的执行目标 ACL、Side 记忆禁写和原生 fork 适配未在本批实现。既有产品源码的先前未提交修改保持原样。本批没有操作真实 Provider 或正式数据；未提交、未推送。

下一步是 Role/member aggregate 与绑定事务设计和实现，复用现有 Kernel 事务、事件和执行凭据体系；不在 AgentHost 再建第二个权威存储。

## 本批检查结果

- 新增 8 项协议/规则测试通过；全仓 `npm run check` 中类型检查通过。
- 全仓 package 测试共 1,804 项：1,785 通过、17 跳过、2 失败。失败为本批未修改的 `RoomKernel stays below its deliberate source-size ratchet`（当前 7,102 行，上限 6,925）和 `interaction icon geometry is frozen...`（UI sprite 哈希与冻结值不符）。没有放宽门槛或更新快照掩盖问题。
- `npm run check` 因上述失败退出，后续 Web unit/parity 等串联步骤未执行，不宣称全仓通过。
- `npm run format:check` 报告 12 个本批未修改文件的格式问题：历史 wake/delivery 测试、产品文档及 scratchpad。本批所有修改文件的定向 Prettier 检查通过；`git diff --check` 通过，新增文档相对链接有效。

本批未将规则接入执行路径，没有完成正式环境修复或部署，因而未重启工作台、未运行真实模型。正式集成批仍必须执行安全重启与真实页面验证。
