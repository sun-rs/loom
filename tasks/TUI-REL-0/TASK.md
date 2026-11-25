# TUI-REL-0：TUI 调用层可靠性审计与加固
背景：顶层角色（Claude/agy 的 Leader、Auditor、Super）跑在 hc TUI 中，loom 通过 adapters/{claude,codex,agy}（screen 分类、对话框按键、输入计划、hook/transcript）和 runtimes/claude-tui 驱动它们。问题：这层只有约 110 行逐字来自 Orca 上游（固定 b7fd7caa3），屏幕分类器大部分来自 exp-relay 实验 worker 写的代码（/Users/sun/Code/exp-relay/orca/lib/screen.mjs 等）。要求做到可靠可证。先读 tasks/ADAPT-*/RESULT.md、tasks/CLAUDE-TUI-RT-0/RESULT.md、tasks/INBOX-0/RESULT.md。Orca 源码按 ADAPT 卡所用固定版本获取（只读）。
1. 来源清单：每个 adapter/runtime 文件按"Orca 上游逐字/Orca 改写/实验代码/自写"分行计数。
2. 对照 Orca 上游同类机制（状态/就绪检测、信任与权限对话框、输入注入与粘贴、回车时机、忙时输入、中断、退出检测），凡 Orca 有经实战的实现而我们是自写/实验代码的，换成 Orca 实现（保留来源注释）；不换的写理由。
3. 失败安全原则落到代码与测试：(a) 屏幕分类不确定 → 不发任何按键，返回 UNKNOWN 并附屏幕证据；(b) 每个按键/输入动作必须有后置确认（transcript 新记录或屏幕状态变化），有限次重试后报告失败，绝不静默；(c) 优先用 hook/transcript 等结构化信号判定状态，屏幕只作兜底。
4. 回放语料：汇总已有 fixtures + 用你自建的 hc 终端对本机当前版本的 claude、codex、agy 实采各类屏幕（启动、信任框、权限框、忙、空闲、多行草稿、限流/报错、中断后、压缩中等）。回放全部样本：误判为"可输入/空闲"导致发键的次数必须为 0，报告混淆表。
5. 版本漂移：记录已验证的 CLI 版本；loom 在 spawn TUI 时检测版本变化并在回执/state 中给出 UNVERIFIED_VERSION 警告（不阻断）。
6. npm test 全绿；RESULT 给出：来源清单、替换清单、混淆表、未解决风险。
可写：adapters/、runtimes/claude-tui/、cli/ 中与版本警告相关的最小改动、tasks/TUI-REL-0/。并行卡 CLEAN-0 正在删 drivers/ 并把其中解析函数并入 adapters/*/transcript——你不改 transcript 解析文件，编辑前重新读文件，冲突写进最终回复。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
