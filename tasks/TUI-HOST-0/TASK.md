# TUI-HOST-0：通用 TUI 层——hc 与 Orca 两种宿主的对比实测与原型
背景：顶层角色（Super/Leader/Auditor，CLI 可能是 Claude、agy、Codex）以 TUI 运行。先读 tasks/TUI-REL-0/RESULT.md：现有 TUI 层只有 40 行逐字来自 Orca，其余为实验代码和自写；根因是 hc 只给纯文本帧，没有输出时钟、没有"按此帧写入"的原子能力、不能读回草稿，导致 hc 报 idle 时仍可能有草稿、Claude 2.1.331 启动未通过。Orca 的终端运行时有 xterm 网格、输出计时、草稿读回补 Enter、agent 状态检测，且由上游维护。Orca 已安装：/Applications/Orca.app/Contents/Resources/bin/orca（用 --help 查 terminal/agent 子命令）。
目标：确定一个能"稳定拉起、稳定带动"三家 CLI TUI 的通用层，宿主可选 hc 或 Orca。
1. 定义通用 TUI 宿主接口（最小）：launch、readState（结构化状态+屏幕证据）、submit（含确认）、interrupt、exit 观察、dialog 处理。CLI 相关部分只留 adapters 的小插件（hook/transcript 位置、对话框按键）。信号优先级：原生 hook/transcript > 宿主状态 > 屏幕。
2. 实现两个宿主后端原型：hc 后端（复用现有 runtimes/claude-tui、adapters）；Orca 后端（通过 orca CLI 的 terminal/agent 命令，优先用 Orca 自己的状态检测与提交逻辑，不复制其 Electron 内部）。
3. 同一测试矩阵对两宿主 × 三 CLI（claude、codex、agy）实测：冷启动+信任框、空闲判定、留有草稿时投递（必须不误发或先安全处理草稿）、忙时投递、连续 20 条投递（每条必须有原生确认，零丢零重）、中断后续作、进程退出检测、限流/错误画面。每项记录成功率、误发数、延迟。
4. 列出 hc 若要达到同等可靠需要新增的原语（例如输出静默时间戳、读回输入行、条件写入），给出接口草案；不要修改 hc 本身。
5. RESULT：对比表、推荐宿主及理由、原型代码位置、未解决风险。npm test 不得因本卡变红。
可写：新目录 tui/、tasks/TUI-HOST-0/、实测目录 /Users/sun/Code/exp-relay/tui-host-0/。adapters/ 与 runtimes/claude-tui/ 只读（需改动写进 RESULT 建议）；inbox/、daemon/ 归 PROTO-HARDEN-0，cli/、skills/ 归 LOOM-UX-1。Orca 只操作本卡自己创建的终端/agent，完成后关闭；不动用户其他 Orca 工作区。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
