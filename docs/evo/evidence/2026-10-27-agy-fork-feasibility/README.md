# AGY Fork / Side 原生能力核实：未完成产品接入

2026-10-27，owner 要求先核实并完成 Fork/Side，再考虑文章/Cindy。
本批基线 f44c204f；没有改产品代码、没有打开 sessionBranches，也没有重启。

## 结论

AGY 1.4.8 的交互式 `/fork` 确实复制原生上下文。但本批没有找到已验证、公开且适合 Loom 的非交互复制接口。因此 **AGY 的 Loom Fork/Side 仍未实现**，不能把本批核实当作功能收口。

### 实际核实

1. 本机 `agy --help` 没有 fork 参数或子命令。
2. `agy -p /fork --output-format stream-json` 明确返回 ERROR：`/fork is not available in print mode (a one-shot run has no conversation worth forking)`，num_turns=0、usage=0。
3. 交互式续接后单独输入 `/fork`，等补全菜单后回车：输出 `Forked conversation.` 及回原会话指令；退出输出新的精确 conversation ID。此原生复制步骤未发送普通 prompt。
4. `--prompt-interactive /fork` 并不调用 slash command：实际把 `/fork` 送给模型，得到“收到 /fork 指令”普通回答；不产生新 ID。不能用这个参数自动化复制。
5. 随 CLI 安装的 `agentapi --help` 仅列 get-conversation-metadata / new-conversation / send-message，没有复制入口。
6. 官方 Python SDK 源码 `google-antigravity/antigravity-sdk-python` @ `91dc5f84565bb505577ac9524f107f453a6e8d1f` 未发现公开 fork 方法；持久化示例是 same-ID resume，不是复制。SDK 文档采用 API key，本批未切换现有订阅执行路径。
7. Multica 的 antigravity.go 没有可复用的会话复制实现。二进制内虽可见 ForkConversation 私有服务符号，但未公开 RPC 不等于已支持接口，本批没有调用该内部接口或修改原生数据库。

## 原生复制与失败探针留账

- 源：`e309c57a-58ca-46a3-afb5-4458e29c657a`，原 Gemini AGY-3 验收会话。
- 原生子会话：`e0d6a89a-c42c-4b23-a264-33c67265c89e`。本批未将它绑定为 Loom 实例，也没有发布到频道。
- 源 39 个步骤的 payload SHA256 与子会话相应前缀全部一致。子会话另有 parent reference；后续失败探针后共42步骤。只读 SQLite 元数据见 native-storage.json。此证据证明本次原生复制，不证明 Loom 身份通知/Side 权限已验收。
- 第一次终端探针错误地将 Escape 与 `/fork` 连发，Escape 吞掉斜杠，源会话收到普通 `fork`，实际生成一条回复。TUI 默认显示 Gemini 4 Argon Medium，未显式锁定预期 Flash Low；此设置错误必须保留，不能算通过的模型 gate。源原生会话因此多了该诊断轮，未删除或回滚历史。
- 第二次以 `--prompt-interactive /fork` 启动原生子会话，显式 Gemini 3.8 Flash Low，但 CLI 当作普通 prompt，产生另一条回复；没有新复制。这一尝试同样失败，不是成功 Fork。
- 两条普通回复没有经 Loom Host/Worker 发布；本批没有可归属的逐轮精确 token 记录，消耗未知，不能计为零，也不能用累计原生会话账直接算本批成本。终端探针均已退出，无残留 agy 探针进程。
- 首次进入原 Channel cwd 的 TUI 原生目录信任确认由本次核实确认；未改账号、未安装 CLI。

## 后续界限

继续实现有三种可能，但都不是本批已完成的能力：

- 上游提供精确 source ID→new ID 的非交互原生复制接口：首选，直接接入现有 NativeSessionCopyAdapter / fork receipt / Kernel Fork+Side。
- 维护终端交互适配：需要独立可靠性设计、版本约束、无模型调用证明和失败不重试；当前探针已证明输入歧义真实存在。不将未经验证的按键驱动投入产品。
- 使用未公开 RPC 或直接复制内部数据库：本批不采用，缺少稳定契约和升级保证。

保持 UI 已有“不支持此操作”状态；不以新建空会话读取 box 冒充继承完整原生上下文的 Fork。Side 同样不能仅靠提示词伪装源频道只读权限。之前日常运行和协作验收仍有效，但本批之后原生源会话含额外诊断输入，后续测试必须注明。

## 来源

- [官方会话文档](https://www.antigravity.google/docs/cli/conversations/)：交互式 /fork、独立会话及不隔离 Git 工作区。
- [官方 SDK](https://github.com/google-antigravity/antigravity-sdk-python/tree/91dc5f84565bb505577ac9524f107f453a6e8d1f)：本批只读核实，没有复制源码。
- 本机 CLI help/changelog、原生 TUI、只读原生数据库；不把生成的普通回答作为复制成功证据。
