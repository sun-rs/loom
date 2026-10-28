# 原生最终回复：产品默认与升级

2026-10-28，owner 批准将已验证的本地回复传输从启动试验开关提升为产品默认。唯一选择 owner 是 daemon 的 `reply-transport-policy.ts`；底层 AgentHost 构造器仍要求调用者明确传入能力，不自行推广。

## 默认矩阵

以下是源码 / Node 部署、新建安装且没有显式覆盖时的选择：

| 运行入口                                          | 默认回复     | 边界                                             |
| ------------------------------------------------- | ------------ | ------------------------------------------------ |
| Codex `codex-app-server/v1` 常驻                  | native-final | 保留原 app-server 和 session                     |
| Claude `claude-stream-json/v1` 常驻               | native-final | daemon 默认选常驻；显式冷配置优先                |
| OpenCode `opencode-server/v1` 常驻                | native-final | 保留原 serve 和 session                          |
| Kimi `kimi-acp/v1` 冷进程                         | native-final | 每轮进程仍续接同一 session，不因此宣称支持常驻   |
| Pi `pi-print-json/v1` 冷进程                      | native-final | 沿用 Pi 已有启动、权限及附加目录限制             |
| AGY `agy-print-json/v1`                           | native-final | 原协议不变；不增加 Fork/Side/Fast 或公平基准能力 |
| Codex `codex-exec/v1` 冷进程                      | Worker       | 独立试验，未随 app-server 默认化                 |
| 冷 Claude / 冷 OpenCode / 冷 app-server、未知入口 | Worker       | 不按 CLI 名称推断支持                            |

独立可执行包（SEA）的默认选择保持原样，不随此次源码部署推广。Kimi native-final 明确要求源码运行；Pi 尚未打包。显式开关仍按原语义传给底层，未实现的打包能力继续报错，不伪装支持。远端 Computer 的冻结接线不变。

native-final 仅替代普通回复的传输：模型输出普通最终正文，Host 用当前投递、原身份和原生正常终态证据提交到既有 Worker 服务。Kernel 的权限、新鲜度、幂等、ACK 和 Task 状态仍是原 owner。多目标、不完整投递及不适用的业务唤醒沿原资格判定回退 Worker；不能接收时不会从 stdout 猜测正文或自动重跑模型。Codex native 模式不暴露竞争回复 MCP。

Kimi ACP 正常结束后仍等待真实原生退出；当前 EOF 清理上限为30秒。固定 Kimi2.1.1 免费探针证明日志持久清理本身可超过旧15秒，故作兼容修正；超时后被 TERM 杀掉再返回零不能视为成功，取消、工具终态和投递围栏不变。不保证所有原生关闭都在此期限内完成。[复现与修复](evidence/2026-10-28-team-cost-repeat/README.md)。后继固定Codex/Kimi三对协作完整通过，当前任务总输入比Herdr为0.498；不是全CLI、所有场景或全部效率指标通过。[重复协作证据与限制](evidence/2026-10-28-team-cost-repeat-v2/README.md)。

## 显式配置、升级与回滚

- 保留既有 `LOOM_CODEX_NATIVE_FINAL_TRIAL`、`LOOM_CLAUDE_NATIVE_FINAL_TRIAL`、`LOOM_OPENCODE_NATIVE_FINAL_TRIAL`、`LOOM_KIMI_NATIVE_FINAL_TRIAL`、`LOOM_PI_NATIVE_FINAL_TRIAL`。未设置使用上表；准确的 `1` 开启；`0` 关闭。为兼容旧严格判断，空值、`true` 等其他已设置字符串也不启用。
- `warmRuntimes.<cli>.enabled: false` 优先选择冷入口；不会为了默认 native-final 绕过。Claude 在没有显式 warm 配置且 native 开关关闭时保持旧冷入口。`enabled: true` 加 native 开关 `0` 则是常驻 Worker。预热是独立设置，仍默认关闭。
- 旧 `LOOM_CODEX_FINAL_OUTPUT_TRIAL=1` / `LOOM_OPENCODE_FINAL_OUTPUT_TRIAL=1` 在 native 开关未显式开启时保留结构化 final 试验；两者都显式为 `1` 时 native 优先，两个发表模式互斥。冷 Codex exec 仍只接受自己的 `LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL=1`。
- 升级不迁移数据库，不改 Role 修订、实例名称、CLI、模型、effort、目录或 session generation，不新建或轮换原生 session。常驻进程的模式变化在空闲边界重建进程并续接既有绑定；原生绑定缺失或不匹配仍失败关闭。
- 回滚普通回复：在 daemon 启动环境将对应 native 开关设为 `0`。若旧结构化 final 试验还设为 `1`，也应设 `0` 才回到 Worker。要恢复 Claude 冷入口，还可显式设置 `warmRuntimes.claude.enabled: false`。按既有空闲检查、备份和优雅重启流程应用，不强杀活动执行。
- 不需要改用户的全局 CLI 配置、账户或模型目录。显式配置不会被升级脚本批量清空；本机部署只移除与新默认完全相同的四个冗余 `1`，并备份原 plist。

## 基准与验收

产品默认与基准身份分开。效率 runner 仍默认 Worker，使用 `RAH_EFFICIENCY_REPLY_TRANSPORT=native-final` 才选择原生回复；`gateReplyTransport` 会明确写入全部相关 `0` / `1`，避免新产品默认污染旧对照。保留 baseline 哈希、自动记忆关闭、实际模型和完整原生用量要求，不把不同传输当同一次代码对照。

默认化当批以新安装无开关、已有显式关闭、旧实验选择、实际工厂接线、独立包隔离、同 session 续接、Worker 回退、失效凭据及 Human 新鲜度做免费定向回归；当批不增加付费测试或发布成本倍率。[测试及部署证据](evidence/2026-10-28-native-final-defaults/README.md)。此前真实 CLI 证据和失败均保留：[Codex/Kimi](evidence/2026-10-28-native-repair/README.md)、[长任务](evidence/2026-10-28-long-closeout/README.md)、[Claude/OpenCode/Pi 当前模型](evidence/2026-10-28-postfix-cost/README.md)、[三方协作](evidence/2026-10-28-three-cli-team/README.md)；后继付费协作复验见上文的固定三对记录。
