# CLEAN-0：清理不用的东西，skill 改名为 loom
背景：loom_new 已统一到 bin/loom + loomd + OAR（无头）+ hc（TUI）。先读 tasks/LOOM-CLI-0/RESULT.md、docs/PROTOCOL-v2.md。目标：仓库只剩被 loom CLI/loomd/测试实际用到的代码，行为不变。
1. 去掉对 drivers/ 的依赖：inbox/tui.mjs、relay/sources.mjs 等引用的 drivers/tui-hooks/{codex,agy}、drivers/claude-tui 解析函数，改用 adapters/*/transcript 里已有的等价解析（无等价时把必要函数并入对应 adapters，保留来源注释）。drivers/codex-appserver 已被 OAR 取代。确认无引用后删除整个 drivers/。
2. relay/：保留 loomd 实际 import 的模块；删除只服务旧实验的独立入口、旧 Codex hook 注入路径等无引用代码（以 import 图和测试为准，删前列清单）。
3. skills：skills/project-loom 改名为 skills/loom，frontmatter name: loom，正文中 project-loom 字样同步。删除 skills/project-hc、skills/project-hc-relay、skills/project-orca（实验已结束；不要动 ~/ 下任何 skill 链接，那由 super 处理）。
4. 依赖：删除 runtimes/oar/node_modules 等子目录重复安装，只留根目录 @botiverse/oar@0.130.1；无用的子 package.json/lock 一并处理。lib/ 等其他无引用目录同理。
5. 用 import 图 + grep 找出其余无引用文件（排除 tasks/、docs/、fixtures 被测试使用者），逐一删或说明保留理由。
6. 验收：根目录 npm test 全绿（报告测试数变化及原因）；node bin/loom --help 正常；RESULT 列出删除清单、删除前后非测试代码行数。
可写：drivers/、relay/、inbox/tui.mjs 的 import 部分、skills/、lib/、runtimes/oar/ 下依赖文件、package*.json、README.md、tasks/CLEAN-0/。并行卡：TUI-REL-0 改 adapters/ 与 runtimes/claude-tui/，PROTO-HARDEN-0 改 inbox/、relay/、daemon/、index/、watch/ 的逻辑——你在 relay/、inbox/ 只做删除与 import 替换，编辑前重新读文件，冲突写进最终回复。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
