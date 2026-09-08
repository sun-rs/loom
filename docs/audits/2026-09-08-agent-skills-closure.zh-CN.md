# Agent Skills 行为族收口（2026-09-08）

本批把 Agent Profile 中误把 `skillRefs`（已发布制品引用）当作 CLI 技能的展示，替换为真实的全局／Agent 工作区技能元信息。没有更改 CLI 的技能加载、安装、账户、提示词、执行、记忆或 Worker 工具路径。

## 来源与采用方式

前端按当日已登录浏览器下载的 Raft `release/v1.12.0`（commit `f1a9a6b83add3db8f44320c753d2f8d8b03b8f06`）核对；不能用 8 月 31 日冻结版代称今天官网。

| 来源                                                                                        | SHA-256 / 定位                                                                                                                                    | 本地采用                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [当前 AgentDetailPanel](../evidence/raft-web-20260908-current/AgentDetailPanel-DSYPOiPi.js) | `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`；UTF-8 字节 offset：`ic` 41715、`rc` 42175、`lc` 42301、`Ps` 42671、`oc` 43230 | 结构移植：名称、说明、`/name` 标签；按 sourcePath 分组；全局／工作区计数；加载、错误、重试、空态          |
| [当前 index](../evidence/raft-web-20260908-current/index-BVfbaScj.js)                       | `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`；`hqe` offset 1965157，经 `J` 导出被 Skills 卡片引用                           | 卡片 2px 边框、16/12px 内边距、hover 描边与阴影；沿用内部语义 tokens                                      |
| 当前 AgentDetailPanel 的 `ql/Wl`                                                            | 同上；offset 2691                                                                                                                                 | globe SVG 几何逐字提取，接入唯一 sprite；登记在 [图标来源](../evidence/raft-icon-semantics-20260908.json) |
| [旧 AgentDetailPanel](../evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js)   | `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`；`Fo` offset 39965、`zo` offset 41480                                          | 仅作版本比较；本行为族与新版同构，不重新标为新版源码                                                      |
| Raft Computer npm 1.0.18 `chunk-ZHWD6VKE.js`                                                | `dcd61f0f7ce1c8804866a50f29c88ba34f6230b6dded4c0504994ea2eb7da2e0`；行 34240 `SKILL_PATHS`、34377 `listSkills`、34417 `scanSkillsDir`             | 后端目录与元信息合同结构移植；不复制其无界全文读取、任意 symlink 和吞掉所有错误的实现                     |

npm 源文件在 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js`。原始发布包仍是取证材料，遵循本项目已有上游来源与授权登记；本批新增 TypeScript 是带安全适配的结构移植，不声称逐字复制。没有新增上游运行依赖。

Claude 的 `CLAUDE_CONFIG_DIR` 是实际覆盖目录，依据 [Claude 官方目录文档](https://code.claude.com/docs/en/claude-directory) 验证；工作区仍使用 Agent 自己的 `.claude/skills`、`.claude/commands`。Codex 的 `CODEX_HOME`、内置 `.system` 与 `.agents/skills` 顺序来自上述 npm 源码。

## 单一 owner 与读取合同

- `packages/protocol/src/agent-skills.ts` 定义元信息和明确读取状态。HTTP 只接受严格的 `agentDefinitionId`，不接受 Human／Agent／runtime 身份伪装参数或任意主机路径。
- AgentHost 的 `agent-skills.ts` 只读目录和有界 Markdown 前缀，对外仅返回 name、displayName、description、userInvocable、sourcePath。
- daemon 用当前 Agent policy 的唯一 `allowedOfferId` 查已配置 Runtime 的真实 `cliId`。技能环境只保留实际启动配置中的 `HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR`，顺序与既有 inherited/static 环境一致；凭据槽或模型映射可能动态覆盖这些变量时返回无法确认，不读取秘密来猜目录。这些内部信息不进入公开 Computer inventory。
- 工作区来源是 coordinator 的 `agent-workspace` 根，绝不是 `runtime-project`／cwd。未启动过的 Agent 可以返回 absent 工作区；读取不会顺便建立 memory 目录。
- Human facade 在 Host I/O 前后重新验证访问权限、owner，并再次检查当前 executionPolicyRevisionId。配置变化期间的结果被拒绝。前端同时按 Agent ID 和 policy revision 绑定请求，撤销旧请求，拒绝过期响应。
- SDK 的 `agent.skills.list` 接 `/v3/client/agents/skills/list`；无业务 mutation、无第二套任务或执行状态。

## 安全边界与有意差异

每个 scope 最多遍历 1000 个目录项；每个候选只读取最多 16384 字节前缀；元信息长度及输出条目另受协议上限约束。不读取／返回 Skills 正文，不运行 frontmatter 中的命令，不声称模型已经加载或调用该技能。

默认 provider 根和默认 `HOME/.agents/skills` 必须仍在 canonical HOME 下预期位置。不能先把任意根 symlink 的目标 realpath 加入白名单，再声称未越界。显式 provider-home 覆盖是受信任的主机 Runtime 配置；普通技能 link 只允许落到已批准的 provider／共享技能根内。Agent 私有工作区拒绝 symlink 越界以及根替换；硬链接与特殊文件也不读取。读前／打开后校验文件类型、单链接、inode/device，返回前重新验证路径。

交叉审计实际发现过“默认共享根 symlink 指向其他 Agent 私有目录”的泄漏反例；已新增 RED、修正默认根校验，并由独立审计重新验证通过。保留失败证据，不把首轮实现当成已审计结果。

缺目录是真实空列表；拒绝访问／读取失败、边界拒绝、超限是明确 error／partial。`skillRefs` 数据及协议保持不变，但不再用制品版本号伪装 CLI 全局／工作区 Skills。

Raft npm 中只有 Claude／Codex 有显式目录表；其他 runtime 的 fallback Claude 不足以证明真实支持。因此 Kimi／OpenCode 现在明确显示“技能目录读取尚未接入”，不显示虚假的 0 条。这个剩余差异仍需其实际 CLI 目录合同证据后单独接入。

## 验证与边界

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-agent-skills/`。

- RED → GREEN：新扫描器、authenticated facade、daemon 真实配置选择、从未启动过的 Agent、默认全局根 symlink、globe 缺符号、命令徽章错误 token。
- 单元／集成覆盖内置技能、共享技能、命令、sourcePath、去重、空目录、正文不泄露、超大 metadata、遍历上限、有效 home 覆盖、特殊文件、权限拒绝、硬链接、其他 Agent 路径、访问撤销和配置改变后的迟到结果；现有 memory/coordinator/workspace/SDK 合同同时回归。
- 浏览器使用临时真实 Kernel／daemon、真实临时 provider 元信息目录、Fake CLI；Chrome／Firefox × 1440×900 与 390×844。验证真实数据、空工作区、加载、503 后重试、真实 Runtime Offer 切换时旧响应被丢弃、不可用状态不伪装空列表、徽章颜色、实际 globe sprite、鼠标 hover。不可用状态注入仅验证前端状态，单独标记为 fixture。
- 浏览器首次缺技能 UI、lazy memory 根 500、开发态重复请求消耗一次性失败、CSS 颜色序列化差异和并行源文件短暂缺失均保留原始日志。调整故障注入时先让所有初始请求失败，点击重试后只允许一个成功读取；没有降低业务断言。

最终专项回归 `tests-final-2.log` 为 39 项通过；最终浏览器 `browser-final-3.log` 四组合通过，receipt 在 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-skills-browser-ztkCLD/receipt.json`（本地截图 DPR 1）。`format-check.log` 和 `diff-check.log` 通过。早期完整类型检查 `typecheck-2.log` 已通过；之后的复跑被并行 Worker self-profile 施工中的类型错误阻断，最终合并类型检查由总集成 owner 确认。截图是隔离本地浏览器验收；不同账号数据的官方 Cindy 全局 8／工作区 0 只能证明官网存在该功能，不能当作本地同条件双边通过。尚未由本批运行正式构建、正式服务重启、付费 CLI、提交或发布；交由总集成 owner 统一完成部署验收。
