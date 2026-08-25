# ADR-0001：建立独立 Room-first 仓库

- 状态：Accepted
- 日期：2026-08-25

## 背景

旧 RAH 已经形成大型 provider-session-first 工作台，包含 Session 生命周期、Provider 历史、TUI、Council listening、Web/PWA、Canvas、Inspector 和大量兼容逻辑。继续在其中原地改造 Room-first 内核，会让新业务协议与旧 transcript/session owner 互相污染，也很难证明新系统是否真的不再依赖 JSONL 和终端输出。

独立 Phase 1 实验已经证明：多个 Agent CLI 可以通过同一 Room 命令完成任务生命周期，验证器只读取 Room projection 和 durable events，而不解释 CLI 输出。

## 决策

在独立仓库 `sun-rs/rah_os` 从零构建 Room-first 核心。

- 只迁移长期架构决策、协议不变量和可复现实验证据。
- 不复制旧 RAH 生产代码、Session store、Council JSONL、UI store 或 provider transcript adapter。
- 使用 Node.js/TypeScript，与未来 Web 和本机 AgentHost 共享类型。
- 第一阶段使用 Node 内建 SQLite，验证本地事务、Room cursor、Inbox、Activation、Outbox 和 lease。
- 采用 npm workspaces，但只建立有明确 owner 的 package。
- 严格执行 red→green→refactor；真实付费 CLI 不进入默认测试。

## 后果

优点：

- 新内核没有旧状态所有权债务。
- 可以用测试定义协议，而不是让现有 UI 行为反向定义协议。
- 失败时不影响正在使用的旧 RAH。
- 将来通过 connector/migration 接旧 RAH，而不是一次性替换。

代价：

- 短期存在两个仓库。
- 旧 RAH 的成熟 UI、runtime 和认证能力需要逐项重新接入。
- 必须抵抗“为了快速可见而先复制旧代码”的诱惑。

## 禁止事项

- 不把旧 provider transcript 当作 Room history 导入。
- 不以 MCP listening 作为通知 owner。
- 不在 Kernel 门禁通过前开发完整 UI。
- 不在没有显式迁移 ADR 前修改旧 RAH 数据。
