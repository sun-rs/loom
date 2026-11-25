# 无头 Claude：`claude -p`、OAR 与 Agent SDK 的计费和条款（2026-11-25）

> 查证日期为 2026-11-25，依据官方文档。条款和计费规则会变，引用前请重新核对。本文不是法律意见。

## 三者的关系
- **OAR（@botiverse/oar 0.130.1）不依赖 Agent SDK。** 它直接启动 `claude --print --input-format stream-json --output-format stream-json …`，依赖列表里没有 `@anthropic-ai/claude-agent-sdk`。
- **Agent SDK** 是官方库，底层同样调用 claude CLI 的 stream-json 模式，外面加了一层控制协议。
- **`claude -p`** 是 print 模式。加上 stream-json 参数后，用的就是上面这套协议。

## 计费与额度
- Pro/Max 订阅在 Claude 和 Claude Code 之间共享 5 小时额度和每周额度："all activity in both tools counts against the same limits"。https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- `-p` 是否和交互模式计入同一额度，官方没有明确写出（**未核实**）。间接证据：
  - CI 用的 `CLAUDE_CODE_OAUTH_TOKEN` "authenticates with your Claude subscription"；
  - `-p` 下只要设置了 `ANTHROPIC_API_KEY`，就会 "always used"（改走 API 计费）。

  https://code.claude.com/docs/en/authentication
- `--bare` 模式 "never reads OAuth credentials or the system keychain"，只能使用 API key，等于改走 API 计费。https://code.claude.com/docs/en/headless
- Agent SDK 的 Quickstart 要求设置 `ANTHROPIC_API_KEY`。SDK 概览写明：除非事先获批，第三方开发者不得在其产品中提供 claude.ai 登录，也不得使用订阅的速率限制。https://code.claude.com/docs/en/agent-sdk/overview
- Max/Ultra/Team 附带的 API credits 可以用于 Agent SDK，但不能用于 Claude Code，也不会改变订阅额度。https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers

## 条款（https://code.claude.com/docs/en/legal-and-compliance ）
- **允许**：用户用自己的订阅登录**未经修改的** Claude Code 二进制。
- **开发者构建产品（包括基于 Agent SDK 的产品）**：
  - 应使用 API key；
  - 不得提供 claude.ai 登录；
  - 不得收集、存储或中转 claude.ai 凭证或 session token；
  - 不得用 Free/Pro/Max 凭证代用户转发请求。
- **其他**：
  - 不得修改二进制，不得移除认证方式；
  - 不得把 "Claude Code" 用作自己产品的名称；
  - 订阅额度 "assume ordinary, individual usage"。
- `CLAUDE_CODE_ENTRYPOINT`：官方环境变量页里没有找到（**未核实**，页面较长，可能没有读全）。条款也没有规定客户端标签。

## 对 loom 的结论
1. **保持现状**：由 OAR 直接调用用户本机未修改的 claude，使用用户自己的登录，仅限个人自用。这是最接近条款允许情形的做法。
2. **不迁移到 Agent SDK**：官方把 SDK 定位为开发者产品路径，要求用 API key。用订阅登录驱动 SDK 属于灰区，政策风险比现状高。
3. **红线不变**：loom 不读取、不存储、不转发任何 claude.ai 凭证；不使用 `--bare`，避免误切到 API 计费；子进程环境里不能出现 `ANTHROPIC_API_KEY`，否则 `-p` 会改走 API 计费。
4. **`CLAUDE_CODE_ENTRYPOINT=loom` 是未见于官方文档的自定义标签。** 按用户以往的决定继续使用，但不要依赖它承担任何计费或标识语义。
5. **对外分发或多人使用**时，订阅登录方案都不适用，应改用 API key（Console 计费）。
