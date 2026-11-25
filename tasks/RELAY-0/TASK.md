# RELAY-0：hc 上的薄 relay（loom 最终回复搬运原型）+ project-hc-relay skill

## 目标
一个**不调用任何模型**的后台进程 `relay`：盯住一个项目的 worker 终端，worker 一轮结束时取出它的**原生最终回复**，**合并**后用 `hc send` 推给 leader（并抄送 auditor），并机械地更新 `.project/workers.md`。这样 leader 派完活就结束本轮，不再调用 hc wait/hc read；worker 不需要调用任何工具回报。

## 先读
- `tasks/TUI-HOOKS-0/RESULT.md`、`drivers/tui-hooks/{codex,agy}`、`drivers/claude-tui`（DRV-CLAUDE-0 可能仍在进行，只读）、`docs/PROTOCOL.md`。
- `skills/project-hc/SKILL.md`（新 skill 在它基础上改）。
- `hc --help` 及子命令帮助（run/get/wait/read/send）。

## 要求
1. 位置：`relay/`（Node ESM，零依赖，尽量 ≤300 行核心代码）。用法类似 `relay --project <dir> --leader <addr> [--auditor <addr>] --window 60`。
2. 发现 worker：读 `<project>/.project/workers.md`（格式见 project-hc skill），新出现的行自动纳入监视。
3. 轮次结束检测与最终回复提取（按优先级，择可行者实现）：
   - 已有 hook 产物（Codex Stop `last_assistant_message`；Claude Stop 的 `transcript_path`；agy Stop 无正文→读 transcript）——只允许用按次启动参数或项目本地配置挂 hook，**不得修改全局** `~/.codex/config.toml`、`~/.claude/settings.json`、`~/.gemini` 配置；
   - 否则：`hc wait` 检测停止 + 按 worker 的 cwd 定位其会话记录取最后一条 assistant 消息；
   - 最后兜底：`hc read` 屏幕尾部（标注 fallback）。
4. 合并投递：同一波 worker 全部停下，或第一个停下后满 `--window` 秒，合并成**一条**消息发给 leader；格式简洁：每个 worker 一段 `<任务ID> <addr> <DONE/FAILED> + 最终回复正文（超过 N 行截断并给出完整内容的文件路径）`。完整回复存到 `.project/replies/<任务ID>.md`。
5. 机械结案：更新 workers.md 的状态和一句话结果（取最终回复第一行）。
6. 去重：同一轮回复只投递一次；worker 被 resume 后再次结束算新一轮。
7. 不吞掉 worker 的中途 `hc send`（那是 worker 直接发给 leader 的，与 relay 无关），relay 只负责最终回复。
8. 新 skill `skills/project-hc-relay/SKILL.md`：与 project-hc 相同的角色约定，区别是：Super 拉起时同时启动 relay；Leader 派活并登记 workers.md 后**结束本轮**，等 relay 消息唤醒，不调用 hc wait/hc read；worker 完成只写最终回复，**禁止用 hc send 报完成**，只有紧急阻塞才可 send；Auditor 接管时还要用 `relay --leader <自己地址>` 重启 relay（或 relay 支持改投递目标）。
9. 测试：单元测试（node:test，用合成样本）；以及一次冒烟测试——用 hc 拉起 2 个很小的 worker（一个 codex、一个 agy，例如各写一个 10 行文件），再拉一个普通 shell 终端扮演 leader，验证 leader 只收到**一条**合并消息、workers.md 被更新。冒烟完 `hc kill` 你创建的所有终端。

## 红线
- 只写 `relay/`、`skills/project-hc-relay/`、`tasks/RELAY-0/`；不 git commit。冒烟测试目录放在 /Users/sun/Code/exp-relay/relay-smoke/。
- 只读 cwd 属于你冒烟目录的会话记录；不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）。
- 只操作你自己用 hc 创建的终端（新目录信任对话框可用 `hc keys <你的终端> enter`）；不碰 Solars、t17*、其他 t2* 终端和 CCP。不修改 rah_os、loom-next。
- 完成后写 `tasks/RELAY-0/RESULT.md`（中文：设计、各 CLI 用了哪条提取路径、测试与冒烟输出、遗留问题），最后一行 `STATUS: done`。
