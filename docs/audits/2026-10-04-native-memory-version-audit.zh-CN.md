# Kimi / OpenCode 原生自动记忆版本审计

本审计支持 efficiency gate 的 `provider-native-auto-memory` 检查，不改变产品记忆合同。结论限 Kimi Code **0.39.1** 和 OpenCode **1.18.32**：所审官方默认实现没有跨 session 自动提炼、保存并回注的原生记忆机制，因此记录 `not-applicable`，不能记录 `enforced` 或声称存在关闭开关。连续 session 的历史、上下文压缩和用户显式配置仍然存在。

## 来源与安装对应

- Kimi 官方 tag `@moonshot-ai/kimi-code@0.39.1` 指向 [5efca0c](https://github.com/MoonshotAI/kimi-code/tree/5efca0c3116743855c28426000073bfe34a4862f)。本机 `kimi --version` 与 npm package 版本均为 `0.39.1`；安装包 `dist/main.mjs` SHA-256：`ed24f532d07e5d00777ae20b42ed18437e116b050bbcfc6ae0f3bc90affca337`。
- OpenCode 官方 tag `v1.18.32` 指向 [545f51d](https://github.com/anomalyco/opencode/tree/545f51d26cc39a907d2867492d498d9607ea5fa4)。本机 `opencode --version` 与 npm package 版本均为 `1.18.32`；安装包 `bin/opencode.exe` SHA-256：`a3c45d4e1d6620b436851f1ef6b25c71befcf06a382e279a1eb1c2196424395e`。

对应关系由发布版本、官方 tag、npm 元数据及安装 bundle 的可见模块核对建立；没有进行可重现构建，不能声称源码与二进制逐字等价。记录的安装 hash 是审计现场证据，gate 每次验证实际 executable 的版本，不把 hash 写成跨平台白名单。自定义同版本重编译不在这一信任假设内。

## Kimi 装配链

- [profile/context.ts:29–115](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core/src/profile/context.ts#L29)：系统上下文来自 cwd、附加目录与显式 AGENTS.md；包含用户 brand home 和 `.agents` 的文件，没有独立自动记忆目录。
- [session/index.ts:303–344、856–872](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core/src/session/index.ts#L303)：装配技能、插件系统提示和 profile；恢复保留 session 上下文。未发现结束 session 时提炼跨 session 记忆的路径。
- [plugin/manager.ts:40–59](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core/src/plugin/manager.ts#L40)：加载已安装插件记录，没有默认自动记忆插件。v2 的 [plugin/store.ts](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core-v2/src/app/plugin/store.ts) 在安装记录不存在时返回空插件集合。
- [skill/builtin/index.ts](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core/src/skill/builtin/index.ts)：完整内置集合为配置、迁移、主题、目标、文档与 sub-skill/review/consolidate；逐项提示并无跨 session 自动记忆管理。write-goal 文案允许遵循既有偏好，不实现记忆提炼或读取器。
- [tools/builtin/index.ts](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core/src/tools/builtin/index.ts)：文件、shell、Web、任务、目标、cron 等显式工具，没有原生自动记忆工具。
- v2 [contextMemory/contextMemory.ts](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core-v2/src/agent/contextMemory/contextMemory.ts) 是本 session 消息 append/undo/compaction 服务；名称中的 Memory 不等于跨 session 自动记忆。

Kimi 原生与产品复用 `providerLaunchPolicy` 的 `KIMI_DISABLE_CRON=1`。这不是记忆开关。用户插件、技能、全局 AGENTS 文件仍可加载，既有隔离局限不因本审计消失；没有改 HOME/KIMI_CODE_HOME 或用户文件。

## OpenCode 装配链

- [plugin/index.ts:67–89、170–190](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/plugin/index.ts#L67)：默认内置插件是 provider 身份/连接适配器；没有默认记忆插件。`flags.pure` 令外部插件列表为空。原生 `run --pure` 与产品 `serve --pure` 一致。
- [session/instruction.ts](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/instruction.ts)：显式 AGENTS/CLAUDE 与配置 instructions 装配，不自动生成长期记忆。官方 [Rules 文档](https://opencode.ai/docs/rules/) 也将规则文件与 `/init` 作为显式功能。
- [session/system.ts:28–62](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/system.ts#L28)：按模型选提示，再组合环境、技能、MCP 等信息；默认模型提示未建立跨 session 自动记忆回路。
- [tool/registry.ts:101–119](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/tool/registry.ts#L101)：显式文件、shell、任务、Web、技能等工具装配，没有内置自动记忆工具。

原生与产品均设置 `OPENCODE_DISABLE_CLAUDE_CODE=1`、`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`，前者关闭 Claude 兼容规则/技能，后者关闭通用外部 skills 来源。gate 同时要求实际 argv 带 `--pure`。用户 OpenCode 自身全局配置、显式规则和文件工具能力仍然存在，不能声称强文件隔离。

## Gate 行为与证明范围

`native-memory-version.mjs` 拥有版本审核表；`native-memory-policy.mjs` 记录来源版本与 revision。创建 baseline 时，精确版本不匹配就在任一付费臂之前拒绝；每次原生首次/恢复 spawn 之前还通过实际 executable 的免费 `--version` 再核对。每轮证据为 `status:not-applicable / evidence:audited-cli-version`，配对必须逐轮匹配版本、revision、provider。未知版本或缺失证据不作为分母。Codex/Claude 仍要求真实关闭配置，不能冒用此豁免。

`native-invocation.mjs` 令 baseline 使用四家各自真实 argv 构造器，恢复沿用同一 session。Claude 额外记录连接解析策略标识，不记录 key 或 URL。

测试覆盖：版本升级在 baseline 和 spawn 前拒绝、首次/恢复同证据、OpenCode 缺 `--pure` 拒绝、fake CLI 实际四次 spawn、逐轮审核证据篡改拒绝，以及 Codex/Claude 原关闭配置不退化。全部使用 fake CLI，无模型调用。本次未验证真实四家付费质量、效率预算或部署；此审计只移除有证据支持的原生记忆前置阻挡。
