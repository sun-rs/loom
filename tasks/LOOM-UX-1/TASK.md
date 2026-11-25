# LOOM-UX-1：按两位老前辈审查改 CLI、hist 与 loom skill
必读：/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17w-skill-review.md、ANSWER-t17g-skill-review.md（两份实战审查，逐条处理并在 RESULT 中给出 已采纳/改写采纳/不采纳+理由 对照表）；tasks/CLEAN-0/RESULT.md；docs/PROTOCOL-v2.md（PROTO-HARDEN-0 正在改，以最新为准）。

## CLI
1. --project 全命令统一一种含义：项目根目录绝对路径（项目 ID 由 loom 派生并在回执显示）；--help 一致。
2. spawn：--task/--wave 仅 worker 必填；--cli/--model/--effort 可省，默认取项目策略文件（定位置与格式，含 preferred 与 deny；deny 拒绝；不自动降级）；回执显示请求值与有效值，不一致标出。
3. loom 为托管会话注入 LOOM_ADDR、LOOM_PROJECT；--from 默认取 LOOM_ADDR。send --wait 仅允许非托管调用方（检测到 LOOM_ADDR 时拒绝并提示结束本轮等唤醒）。
4. 新增 loom doctor --project DIR：残留进程/hc 窗格/OAR 子进程、临时目录、本项目 worktree、陈旧锁、uncertain 投递、未封存波次；只报告，--fix 仅清理本项目所属资源。
5. loom state：展示上下文占用、压缩次数、轮数等原始信号（只报数不建议）；headless 支持由 PROTO-HARDEN-0 在 daemon/index 侧实现，你只负责呈现，接口对齐。

## hist
6. --turn N 精确取轮；--outcome failed|aborted|quota|blocked|unverified 过滤；--wave W 波次视图（成员、各自终态、耗时、净行数、改动文件、测试退出码、合并消息投递去向）；--grep KW 跨会话检索（命令、错误、路径）。
7. diff：每轮记录起止 HEAD；--diff 给出该轮/该任务 base..candidate 的 numstat（拆 src/test/docs）与被删改的测试断言；--evidence 直接带出证据卡摘要与路径。
8. L1 每轮附事实行（退出码、改动文件数、claims 判定）；正常轮 ≤400 字节，异常轮允许保留完整失败命令与首行错误（上限约 800 字节）。L2 增加 --tool shell|edit、--cmd REGEX、--tail N。输出给出 transcriptPath 与行偏移作为最后兜底。

## skill（skills/loom/SKILL.md，CLEAN-0 已改名）
9. 按两份审查重写，目标 ≤90 行，只写角色怎么用，不写运行时内部细节。super 已定的取舍：
   - worker 不发信：首行 DONE/BLOCKED/FAILED，阻塞写进最终回复并结束本轮，Leader 用 loom send 同会话续作。
   - skill 只教 queue 与 interrupt；steer 留在 CLI，不进 skill。回执对账交给 loomd，角色不重发。
   - Auditor：每次合入前都独立复核（证据卡 MISMATCH/UNVERIFIED 优先、base..candidate diff 对照卡面目标、隔离 worktree 复跑）；对可复现的阻断缺陷可用 interrupt 否决并写理由。
   - 选择题：禁止交互式选择器和停等审批；但涉及架构/范围取舍时，可以向 Super 用文字给出"事实 + 选项 + 推荐"，然后结束本轮。
   - 沙箱：遇到沙箱拒绝原样报告，不自行绕开（不禁止项目已授权的启动参数）。
   - 示例不绑定 Claude，CLI 由策略决定；Leader 负责建/清 worktree，并为 Auditor 准备复核 worktree。
   - 换班顺序：写交接 → stop 旧会话 → spawn 新会话 → handover --to。
   - Super 主动用 hist/ls/state 了解进度，项目级事件从通知队列一次性取用。
10. npm test 全绿；RESULT 附 skill 全文行数和每个新增命令的实测输出样例。
可写：cli/、bin/、skills/loom/、README.md、tasks/LOOM-UX-1/。需要 index/daemon/relay 新字段时，以最小增量改动并在 RESULT 列出（PROTO-HARDEN-0 同时在改这些目录，编辑前重新读文件，冲突写进最终回复）；adapters/ 归 TUI-REL-0。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
