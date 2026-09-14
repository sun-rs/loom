> 后续决策：用户已选择仅实现环境变量，不开放本文建议中的专属或原始 CLI 参数。当前行为见[环境变量收口](./2026-09-13-agent-environment-only.zh-CN.md)；下文为当时研究证据。

# Agent 环境变量与 CLI 参数研究（2026-09-13）

## 结论

Raft 对应“更多”表单提供的是 Agent 环境变量（`envVars`），不是任意 CLI 附加参数编辑器。模型、推理强度、快速模式另有结构化字段，由 Runtime driver 转成启动参数或协议设置。RAH OS 的任意附加参数编辑器是本地扩展；目前只有基本文本拆分和受控参数拦截，不能称为各 CLI 的完整配置支持。

本批产品修改仅让 Settings 的四个 Provider 卡片默认展开，仍可手动折叠，重新进入/刷新默认展开；保留忙时投递开关和启动配置只读。以下参数分层为研究建议，未在本批实施。

## Raft 第一方证据

来源 https://app.raft.build/ ，冻结 `docs/evidence/raft-web-20260908-current/AgentDetailPanel-DSYPOiPi.js`（SHA-256 `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`）：`Fc` 从 `agent.envVars` 生成键值行，保存 `updateAgent(id,{envVars})`；对应文件未发现 `additionalArgs`、`extraArgs` 或 `cliArgs` 表单字段。这是已检查表单的边界，不据此宣称整个 Raft 没有任何参数配置。

[Computer 1.0.31 静态提取证据](./2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)来自 https://cdn.raft.build/computer/1.0.31/raft-computer-darwin-arm64.gz ，提取 main.js SHA-256 `d971d8f23b3178b008ce409964082f1dacb1d638a8965f11d19fef274331aeca`。切片 `packages/daemon/dist/chunk-5Y2HSDGS.js`：

- 1497–1519：规范化字符串环境变量，剥离 Runtime 受控键。
- 1538 起 `composeRuntimeConfig`：model、mode、reasoningEffort、envVars 分开保存。
- 5853 起：进程环境合并 host 环境、Agent envVars，然后叠加运行时受控环境。
- 6358 起 `buildClaudeArgs`：模型/effort/session 等由 driver 生成；fast mode 转为 `--settings` JSON。
- 7580 起 `buildCodexAppServerArgs`：driver 自己生成 `app-server` 和受控 `-c` 等参数，不是用户表单直接传 argv。
- 8553 起 `buildKimiArgs`：此版本 Raft 使用 `--wire`，与 RAH 当前 `kimi acp` 不同，不能原样移植其参数表。
- 8890 起：`OPENCODE_CONFIG_CONTENT` 作为 Agent 环境变量读取并解析 JSON。

没有中央 Server 源码证据；上述能证明 Web 字段及 Computer 端消费方式。所有发布代码仅作授权静态分析，沿用现有许可/来源记录，没有复制代码或引入生产依赖。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 Agent inspector/runtime picker 没有为本问题提供比 Raft Computer 更完整的参数转换证据，不移植其实现。

## 当前安装版本与具体差异

仅运行 `--version`/`--help`，未启动模型会话或执行付费调用。

| CLI         | 本机版本及 RAH 使用入口                 | 需要区分的规格                                                                                                                                                         |
| ----------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | 0.154.0；`codex app-server`             | `-c/--config key=value` 为可重复的配置覆盖，支持点分键；值按 TOML 解析，无法解析时退回字符串。不是把所有配置写成 `--键 值`。                                           |
| Claude Code | 2.1.268；`claude --print … stream-json` | 普通选项如 `--debug`；`--settings` 接收 JSON 文件或 JSON 字符串；`-c` 是继续之前会话，不是配置覆盖。                                                                   |
| Kimi        | 0.39.1；`kimi acp`                      | 根命令 `-c` 同样表示继续会话；本机 ACP 子命令帮助仅列 login/region/help。普通根命令、Raft 的 wire 模式和 ACP 配置能力必须分别检查；不能承诺任意根命令参数在 ACP 有效。 |
| OpenCode    | 1.18.30；`opencode serve`               | 服务参数如 `--print-logs`、`--log-level DEBUG`；业务配置支持 JSON/JSONC 文件与 `OPENCODE_CONFIG_CONTENT` 内联 JSON。RAH 管理的 host/port 不应由用户附加参数竞争。      |

官方依据：[Codex CLI](https://developers.openai.com/codex/cli/reference/)、[Claude CLI](https://code.claude.com/docs/en/cli-reference)、[Kimi ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)、[OpenCode CLI](https://opencode.ai/docs/cli/)、[OpenCode 配置](https://opencode.ai/docs/config/)。文档可能更新，RAH 接受能力应绑定本机版本和实际使用的子命令。

环境变量的注入方式可以统一为字符串键值对，但变量名、值类型、优先级及支持情况由 Provider 决定。JSON 配置作为一个环境变量传递，仍是环境变量，不会自动变成 CLI 参数；在表单里填 KEY/value，无需写 `export`，也不执行 shell 展开。

## RAH OS 当前支持边界

单一存储 owner 是 daemon `RuntimeGuideSettings`，按 AgentDefinition + runtime 保存。读取在 Activation 准备阶段冻结；不热改已启动进程，不改写 CLI 全局配置文件。

- **环境变量**：支持合法字符串键值、Agent 作用域、持久保存、值遮罩及受控键保护。最多 64 个变量，JSON 序列化长度最多 16384 字符，单值最多 8192 字符。`OPENCODE_CONFIG_CONTENT` 可传入，但 RAH 当前不校验其 JSON 内部 Provider 配置；未知变量可能被 CLI 忽略。保存成功不是实际生效证明。
- **原始附加参数**：保存 argv 数组，追加在固定启动 argv 后。文本支持空白分隔和 JSON 双引号字符串，不是 shell；不支持单引号 shell 语法、变量展开或命令替换。最多 64 个参数，JSON 序列化长度最多 8192 字符。
- **受控参数**：当前通用拦截表会拒绝 `-c`、`--config`、`--settings`、模型、会话、协议与监听端口等。因此当前 UI **不能直接填写 Codex `-c key=value` 或 Claude `--settings`**。
- **未完成的语义校验**：其他参数并非全部可用；没有按 Runtime/CLI 版本/子命令验证名称、别名、值类型、重复规则及组合。一个未知 `--xxx` 可能保存成功但启动失败。
- **去重边界**：旧实现仅对全局与 Agent 两个作用域的完整参数组去重/冲突检查。全局追加配置已退役，不能继续把它宣传成全面的 Provider 参数去重器；同一作用域的重复选项仍取决于 CLI。

## 建议的安排与支持层级

1. **保留统一环境变量编辑器**，作为 Raft 对等能力。补充 Provider 常用变量提示、已知 JSON 值校验、类型提示；自定义变量明确区分“已保存”和“CLI 已支持”。系统身份、通信和记忆策略维持现有 owner。
2. **模型、推理强度、快速模式继续用现有结构化控件**。由 adapter 转为 argv/配置/协议字段，附加配置不得重复覆盖，避免出现两个生效来源。
3. **Provider 专属高级配置独立建模**：Codex 按配置键解析 TOML 值后生成重复 `-c`；Claude 按允许的 JSON 设置键统一生成一次 `--settings`；OpenCode 对配置对象按其 schema 处理并与受控内容明确合并；Kimi 先确认 ACP 暴露的配置项，再通过对应协议/环境字段映射。
4. **原始 CLI 参数仅作为高级能力**，应有每 Provider、每入口的允许项与值校验。优先覆盖已验证的诊断项，未经验证的参数不能以“已支持”展示。重复 `-c` 应按配置键处理，而不是按 `-c` 字符串去重；可重复路径项、布尔选项、单值参数分别定义规则。受控键冲突给出具体原因，不静默覆盖。
5. **发布验收按项记录**：字段保存/重读、最终 argv/env、假驱动行为和 opt-in 真实 CLI 生效分开证明。本次仅完成研究及默认展开修改，不宣称以上专属配置已实现。

## 本批验证与交付

默认展开测试先失败于 details 缺少 open 属性，再通过桌面/390px 浏览器验证，包括手动折叠、刷新恢复展开、Guide 键盘/鼠标操作及启动字段只读。`npm run check`、格式、diff 和正式 Web 构建通过。空闲检查、持久状态备份及安全重启后，冻结构建 `5011b614ed7ab765c12718b7f64bbee75c948b134916b0b35b02fe1797fb1ef1` 的 loopback/LAN/Tailnet 新浏览器页面均验证四卡片默认展开、Guide 开关和 Agent 编辑入口。没有修改正式 Agent 配置或运行付费模型，CLI 帮助核查不等同于真实任务生效验收。
