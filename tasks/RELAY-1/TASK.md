# RELAY-1：relay 按波次投递、去掉项目本地 Codex hook、精简唤醒

## 背景
EXP-RELAY-1 第 1 轮（报告：/Users/sun/Code/exp-relay/runs/20261124151218-59651/REPORT.md）显示 H1（hc+relay）没有省 token：
1. relay 在项目目录写了 `.codex/hooks.json`，Codex 因"文件夹配置可自动执行代码"弹出信任框，T1/T2 卡住约 20 分钟。
2. 60 秒窗口导致同一波被拆成多次投递，Leader 被唤醒 4 次、每次复核；Auditor 每批抄送也被唤醒 4 次。H0 的 Leader 用一次阻塞等待整波，只醒一次。
目标：H1 的 Leader+Auditor 唤醒次数 ≤ H0，即每波只醒一次。

## 要求
1. **波次语义**：Leader 一次派出并登记的一组 worker 为一波（workers.md 新行在短时间内连续出现，或 Leader 在行尾写同一个波次号——你选一种简单可靠的方式并写进 skill）。整波所有 worker 都停止才投递**一条**消息；`--window` 改为兜底超时（默认 900 秒），超时则投递已完成的部分并注明未完成者。单 worker 的波次立即投递。
2. **Auditor 抄送**：每波只抄送一次（与 Leader 同一条），或仅在波次含 FAILED 时抄送——选择更省的并在 skill 中写明 Auditor 收到后只做一次只读核查。
3. **Codex hook 不落在项目目录**：改用按次启动参数注入（如 `codex -c 'hooks...'`，先用 `codex --help`/官方文档确认语法），或无 hook 路径（`hc wait` 检测停止 + 按会话 ID/cwd 读 rollout 的最后一条 assistant 消息）。确认新目录下启动 Codex 不会出现额外的"文件夹配置"信任框（在全新目录冒烟验证）。agy、Claude 同理不要触发额外信任框；如 agy 必须用项目本地 `.agents/hooks.json`，确认它不引起额外弹窗。
4. 更新 `skills/project-hc-relay/SKILL.md`：给出 worker 启动命令（含 hook 注入参数）；Leader 每次被唤醒只做：更新判断、派下一波、必要时一次验证；不要逐批重复跑全量测试，最终汇总验证一次。
5. 更新单元测试；冒烟：在全新目录 /Users/sun/Code/exp-relay/relay-smoke2/ 用 hc 拉起一个普通 shell 扮 Leader，同一波 2 个 worker（codex + agy，完成时间相差 >60 秒），验证无信任卡死、Leader 只收到一条消息。冒烟完 `hc kill` 自己的终端。
6. 同步检查 /Users/sun/Code/exp-relay/launch.sh 的 H1 部分（relay 启动参数、提示词）是否需要相应修改，需要则修改并 `zsh -n` 检查；不运行 launch.sh。

## 红线
- 只写 `relay/`、`skills/project-hc-relay/`、`tasks/RELAY-1/`、`/Users/sun/Code/exp-relay/launch.sh`、`/Users/sun/Code/exp-relay/relay-smoke2/`；不 git commit。不改全局 ~/.codex/config.toml、~/.claude/settings.json、~/.gemini 配置。
- 只读冒烟目录所属的会话记录；不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）。
- 只操作你自己创建的终端；新目录信任框可用 `hc keys <你的终端> enter`（Claude 的信任框光标默认在 No，需 down enter）。不碰其他终端和 CCP。
- 完成后写 `tasks/RELAY-1/RESULT.md`（中文），最后一行 `STATUS: done`。
