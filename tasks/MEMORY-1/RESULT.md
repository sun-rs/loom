# MEMORY-1 结果

- `docs/MEMORY.md` 成为 v1 设计基准，记录八项用户决定和七个待定问题。设计明确了记忆写入和授权、集中历史的确认顺序，以及换班和切换 CLI 后如何重新取得索引。 [设计](../../docs/MEMORY.md)
- `docs/MEMORY-TESTS.md` 给出 37 个编号用例，包括 19 个单元用例、12 个双进程集成用例及 6 个原生 CLI 用例。每例写明准备、动作、断言和对应决定。已标出 Pilot v0 部分覆盖的断言。 [测试计划](../../docs/MEMORY-TESTS.md)
- OpenCode 的官方资料确认了 SQLite 存储位置和会话导出／读取入口。agy 与 OpenCode 均未找到可用配置或握手核实原生长期记忆已关闭，本版标为未覆盖。 [OpenCode 存储](https://opencode.ai/docs/cli/#paths) · [OpenCode 会话命令](https://opencode.ai/docs/cli/commands/#session) · [Antigravity CLI 配置](https://antigravity.google/docs/cli/reference)
- 本卡只交付文档。Pilot 仅读，主仓库未提交。已核对设计行数、用例编号、决定覆盖和结果文件状态行。测试计划中的产品用例留待实现时运行。

STATUS: done
