# EXP-PREP-1：准备 EXP-RELAY-1 对比实验（不运行实验本身）

## 背景
要比较三种编排方式的 token 消耗：H0 纯 hc（leader 用 hc wait/hc read 拉结果）、H1 hc + loom relay（relay 把 worker 原生最终回复合并推给 leader，见 tasks/RELAY-0）、O Orca（project-orca skill，relay=worker_done）。
上一轮实验参考：/Users/sun/Code/exp-csvstat（seed/、grader/、launch-r3.sh、tokens.py、timeline.log），请先阅读它们并沿用结构。
本轮任务内容是 loom 真正需要的"会话记录解析层" loom-transcript，规模要大（每个 worker 预计 20~40 次模型调用）。

## 交付（全部在 /Users/sun/Code/exp-relay/ 下）
1. `fixture-lab/`：一次性目录。用 hc 在其中分别拉起 codex（gpt-6.2-sol）、claude（sonnet）、agy，各跑几段**无害的小对话**，覆盖：多轮、调用工具（读文件/执行命令）、中途中断（Ctrl-C/Esc）、中文和 emoji、长输出。然后**只**收集 cwd 为 fixture-lab 的会话记录：Codex `~/.codex/sessions/**`（按 cwd 过滤）、Claude `~/.claude/projects/-Users-sun-Code-exp-relay-fixture-lab*/`、agy 的 transcript_full.jsonl（按该会话定位）。再顺手用 `hc read` 抓几份屏幕文本：idle、busy、信任对话框、（如能复现）错误状态。
2. `seed/`：实验仓库种子。`SPEC.md` 定义 5 个任务：
   - T1 Codex 会话解析：最终回复、每轮 token 用量、轮次边界、被中断的轮（codex worker）
   - T2 Claude 会话解析：同上，含 sidechain、compaction（codex worker）
   - T3 agy transcript 解析：同上（agy worker）
   - T4 屏幕状态识别：从屏幕文本判定 idle/busy/trust-dialog/rate-limit/auth-fail，三家各一套（agy worker）
   - T5 统一 schema + CLI `loomx last-reply|usage|state <file>`，依赖 T1~T4（codex worker）
   接口（函数名、返回结构、CLI 输出 JSON 格式、退出码）必须写死，便于隐藏测试。`fixtures/` 放公开样本。纯 Node（ESM，node:test），零依赖。
3. `grader/`：隐藏样本（与公开样本不同，含边界：空轮、compaction 之后、超长输出、最后一行截断）和 `accept.test.mjs`，用法 `DIR=<repo> node --test grader/accept.test.mjs`。用一个参考实现（放 `grader/reference/`，**不能**进入 seed）验证隐藏测试全部通过，再确认空 seed 时全部失败。
4. 三个臂的仓库 `h0/ h1/ orca/`：由 seed 初始化 git（同一初始 commit），并 `orca repo add` 注册 orca/。
5. `launch.sh`（zsh）：参照 launch-r3.sh，同时拉起三臂；角色：leader=agy、auditor=claude sonnet、worker 按 SPEC。H0 用 project-hc skill，H1 用 project-hc-relay skill（RELAY-0 交付，launch 里同时启动 relay），O 用 project-orca relay=worker_done。不杀 leader。脚本里写清每臂的 BRIEF 完全一致。**只写，不运行。**
6. `tokens.py`：在 exp-csvstat/tokens.py 基础上扩展到三臂，并输出每个 leader/auditor 每次调用的上下文大小序列（上下文增长曲线）、每个 worker 中途 `hc send`/`orca orchestration send` 次数。
7. `README.md`：怎么重置、怎么跑、怎么评分、怎么统计。

## 红线
- 会话记录只允许读取 cwd 属于 /Users/sun/Code/exp-relay/fixture-lab 的那几份；不读任何其他会话记录、凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）。样本中如出现用户名/绝对路径/账号信息，替换为占位符。
- 只操作你自己用 hc 创建的终端；新目录的信任对话框可以用 `hc keys <你的终端> enter` 确认。不碰其他任何终端（包括 Solars、t17*、t2*）和 CCP。fixture 采集完后 `hc kill` 你创建的终端。
- 不运行 launch.sh，不修改 rah_os、loom-next、exp-csvstat；loom_new 只写 tasks/EXP-PREP-1/。不 git commit loom_new。
- 完成后写 `tasks/EXP-PREP-1/RESULT.md`（中文：交付清单、样本覆盖表、参考实现过隐藏测试的输出、遗留问题），最后一行 `STATUS: done`。
