# Claude 具体版本模型的推理强度闭环

## 根因与设计

此前 Raft 补充的具体模型候选走 `custom_model`，前端仅显示默认，提交 helper 强制默认，Protocol 也禁止显式 effort，Kernel resolved model 不携带 effort，AgentHost 自定义路径只传 model。此前并不存在“已接受 high 后正常执行”的保证。不能只开放下拉框而遗漏后续层。

Protocol 的 `custom-model-effort.ts` 唯一拥有自定义模型显式 effort 的提交边界；前端消费该边界，Kernel 保留到冻结 Placement，AgentHost 再校验并将 Claude 的 effort 传给既有 stream-json driver，driver 在实际子进程 argv 中传递 `--effort`。不新增会话或调度 owner，不改进行中的 Run，不自动迁移用户已保存的默认值。

## 来源与能力证据

Raft 来源沿用 [原候选移植记录](2026-09-20-claude-catalog-custom-models.zh-CN.md)：Computer 1.0.32 静态候选，及留存 AgentDetailPanel-CW_VMZT6.js 的运行时级 reasoning 入口。继续使用 RAH 既有原生适配器；Multica 不是此链路 owner，无新增上游代码复制。

2026-09-21 核对 [Claude Code 模型配置](https://code.claude.com/docs/en/model-config#adjust-effort-level) 和 [官方 effort 文档](https://platform.claude.com/docs/en/build-with-claude/effort)。精确允许本项目已有的以下版本候选：

- Sonnet 5、Opus 5/4.8/4.7、Fable 5/5.1：low、medium、high、xhigh、max。
- Sonnet 4.6、Opus 4.6：low、medium、high、max。
- 未列出的 ID、未知版本、Haiku、自定义 Codex：保持默认，不根据子串或型号家族推断能力。

本机探测 binding 继续使用探测返回的档位。上述自定义路径是**文档支持的显式提交许可**，保留 custom_model provenance，绝不伪装成 probed/certified；新建和编辑页注明“可按模型文档选择推理强度；当前 CLI 与账户支持尚未验证”。CLI 版本、组织策略、提供方设置仍可能拒绝或调整实际行为，不能把参数传递证明当成服务端执行强度证明。未支持组合在 Protocol/Host 明确拒绝，Kernel 不选取；不静默改为默认或 fallback。

## 实现和回归

- 新旧 ModelIntent/ResolvedModel 默认值兼容；显式自定义 effort 被持久化，冻结模型相等判断也比较 effort。
- 前端 selectedModelIntent 保留所选值；非法组合校验失败，不丢弃字段。
- 已保存配置与 Worker 实际 Run 投影保留 effort；真实 model ID 原样传递。
- 先复现 UI 候选仅默认、Placement 丢 high、Fake Claude 未收到 --effort 三个失败，再修改实现。
- Protocol 负向覆盖未知 ID、Haiku、Sonnet 4.6/xhigh、ultra 和自定义 Codex；AgentHost 对伪造 resolved model 二次拒绝。
- Kernel 管理测试覆盖创建 high、修改 low、读取已保存的 policy；Worker 读取验证 custom provenance 与 effort；Placement 严格序列化通过。
- Fake Claude 原生子进程证明 `--model claude-sonnet-5 --effort high`；未知自定义默认路径仍不发送 effort。
- 隔离浏览器覆盖编辑与创建提交、1440/390 提示；路由捕获的 UI 提交与 Kernel 持久化、Host 子进程分别验证，不声称一个浏览器脚本完整执行了付费模型。

未运行付费模型。已保存为默认的配置保持默认，不推测用户历史上原本希望的强度。

## 交付验证

相关协议、Kernel、Host 与前端单元测试 175 项通过，之后补充的持久化读取、冻结证据 effort 防篡改和 Worker 实际 Run 投影测试通过。浏览器新建和编辑请求携带显式 effort，未知自定义默认路径回归通过。类型检查、正式构建、`git diff --check` 通过。

全仓库 `npm run check` 在原有 `/v1/worker/message-present` parity 注册缺失处停止；Web 单元测试 477 项中 466 通过、11 项为此前记录的 source/contract 失败。`format:check` 报告原有 wake/delivery 5 文件及已有 scratchpad 5 文件，本批变更已格式化。不把这些检查声称为全绿。

正式重启守卫检查通过，备份 `pre-restart-bab262a1-bcf6-473a-be69-b9b9a2831c6e`，新进程 49082；正式 Web 构建 `ec3d262bfd2f9808e0913d7938f6c2e97d8c3082690793472506c42cf3214a49`。全新真实浏览器读取该构建，编辑 Claude、选择 Sonnet 5/High 并检查提示后取消；未保存正式配置、未产生付费调用。正式只读检查策略阻止环境配置读取，因此此步骤只证明模型/effort 选择交互，不冒充正式保存验收；保存与执行参数由独立 Kernel/Fake CLI 测试证明。

全量 `npm test` 完成：1781 项，1761 通过、17 跳过、3 失败。失败分别是未修改的 RoomKernel 7102 行超过 6925 行限制、迁移测试期望 schema 56 而当前为 57、未修改的 interaction-icons.svg 冻结哈希不符。未提高阈值或改写快照掩盖这些问题。专项修复测试均通过，但全仓库未全绿。
