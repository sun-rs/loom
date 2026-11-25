# EXP-PREP-1 结果

交付物位于 `/Users/sun/Code/exp-relay/`。本轮完成了样本采集、基线初始化和离线验证，三臂实验尚未启动。

## 交付清单

| 路径 | 内容 |
| --- | --- |
| `fixture-lab/` | 3 份脱敏原生 JSONL、13 份 `hc read` 屏幕帧、采集说明和测试输入 |
| `seed/` | T1–T5 的分工、依赖、接口和 CLI 契约。含 3 份会话样本和 17 份公开屏幕样本 |
| `grader/` | 独立的隐藏样本、37 项 `accept.test.mjs` 验收和零依赖参考实现 `reference/` |
| `h0/`、`h1/`、`orca/` | 各自独立的 Git 仓库。唯一初始提交均为 `918bc052dcdaeac27ed4f597a3a8bd37908c4bc5`，逐文件与 seed 一致。Orca 列为已注册 Git 仓库 |
| `launch.sh` | 并行启动 H0 `project-hc`、H1 `project-hc-relay` 和 O `project-orca relay=worker_done`。三臂复用同一段 BRIEF。附启动时间线和角色地址记录 |
| `tokens.py` | 按会话清单统计三臂、角色和 worker 的用量，输出 Leader、Auditor 的逐调用上下文序列和每个 worker 的中途发送次数 |
| `README.md` | 重置、启动、隐藏评分和统计步骤 |

## 样本覆盖

| 覆盖项 | Codex | Claude Code | agy |
| --- | --- | --- | --- |
| 原生多轮 | 5 轮，53 行脱敏记录 | 5 轮，27 行脱敏记录 | 4 轮，16 行脱敏记录 |
| 中文、emoji、长输出 | 回复含中文与 emoji，工具输出 220 行 | 回复含中文与 emoji，工具输出 220 行 | 回复含中文与 emoji，工具输出 220 行 |
| 工具调用 | 执行命令读取本地文件 | Read 和 Bash | 读文件和 `run_command` |
| 中断后继续 | Esc，原生 `turn_aborted` | Ctrl-C，原生 `interruptedMessageId` | Esc，模型步骤后出现步号缺口，无显式中断事件 |
| 用量与压缩 | 原生日志同时含 `token_usage_record` 与 `token_count` | 重复消息 ID，实际 `/compact` 及压缩后新轮。支线另用隐藏样本 | `PLANNER_RESPONSE` 逐步用量，含缓存读 |
| 原生屏幕 | idle、busy、取消后画面、工具退出 1 | idle、busy、取消后画面、压缩后画面 | idle、busy、取消后画面、信任对话框、软登录提示 |
| 补充验收 | 空轮、旧版累计差分、中断、截断、合成状态 | 空轮、支线、压缩、超长工具输出和回复、截断、合成状态 | 空轮、重写、显式和推断中断、超长工具输出、截断、合成状态 |

会话采集范围为 `fixture-lab/`。先用进程 cwd、原生项目目录或本次独有的新会话与写入节奏定位，再核对相应记录。样本中的账户、路径、用户名、终端发件人和会话标识已替换。三个采样终端 `hc kill` 后均确认为 `finished`，采集临时文件已清理。

## 验证

Node v25.9.0 下执行 `DIR="$PWD/grader/reference" node --test grader/accept.test.mjs`，退出 0。

```text
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`DIR="$PWD/seed" node --test grader/accept.test.mjs` 退出 1，`tests 37`、`pass 0`、`fail 37`。隐藏样本与参考实现均存放在 `grader/`，三臂各有 24 个与 seed 逐字节一致的跟踪文件。

`tokens.py` 通过 21 份合成会话的端到端验证。核对了 6 条 Leader/Auditor 上下文序列和 15 名 worker 的发送计数。检测覆盖重复工具记录、here-document、回显、可执行文件绝对路径、终局回报排除以及 cwd 不匹配拒收。`zsh -n launch.sh` 退出 0。`orca repo show` 确认 `orca/` 已注册。

## 遗留问题

- 实际采样中 Codex 出现工具退出 1，agy 出现软登录权限提示。认证失败与限流均使用合成屏幕覆盖，尚无原生采样。
- agy 会话需要由统计清单登记方确认 native session 与 cwd 的对应。上下文只统计原生日志提供的用量，Claude 支线用量不纳入主会话。中途发送数来自直接命令记录，动态脚本和送达成功数需要运行证据。
- 三臂的启动和联调留待实验运行。本轮对 `launch.sh` 只做了静态检查。

STATUS: done
