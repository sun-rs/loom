# MERGE-PILOT-1 结果

在独立工作树的 `merge/pilot-1` 分支，把 Pilot `pilot-1` 的 `2bf357d3` 合入任务指定的 main 基线 `8f4ef4e5`。分支留给 Super 审阅，尚未合回 main。工作期间 main 另增了研究文档提交 `4aa5a826`，本分支保留卡面指定基线。Pilot 仓库只读。

## 冲突与兼容处理

- `daemon/tui.mjs` 采用 Pilot 的 OpenCode 绝对可执行路径解析，同时保留 main 的 Worker 私有 HOME/XDG、注入环境及 Claude 工作区信任选项。
- `skills/loom/SKILL.md` 保留 Super 的通知处理规则和 Worker 的绝对路径 `"$LOOM_BIN"` 约定。加入 Pilot 的记忆格式、维护和查询规则，标明 `.project/memory/` 是 v0 存储和 v1 的导入来源。
- OpenCode Mini 的紧凑页脚、忙态提示和空草稿占位符已接入 main 的共享草稿校验。现有 Loom 层中断守卫保持生效。
- 记忆 v0 的显式原件仍须能在项目内核实。补测了无扩展名的原件、指向项目外的符号链接以及正文中的项目外引用。常规漂移检查仍使用 FIX-5 的过滤规则。只在 `docs/MEMORY.md` §6 记录 v0 的接入情况，未实现 v1。

## 验收

- `npm test` 在合并前通过 291 项，合并后通过 297 项。 [基线日志](</Users/sun/Code/exp-relay/merge-pilot-1/npm-test-main.log>) · [合并后日志](</Users/sun/Code/exp-relay/merge-pilot-1/npm-test-acceptance.log>)
- 已保存 `git diff main...merge/pilot-1 --stat` 的输出。 [分支差异统计](</Users/sun/Code/exp-relay/merge-pilot-1/diff-stat.txt>)

## 遗留

- Loom 层仍不支持 OpenCode 中断。
- 生产 `openTui` 携带 `effort` 的 OpenCode 路径尚无实测。
- 记忆 v0 已有自动化测试，尚未用于真实会话。
- `examples/policy.json` 的五个角色各列出两家厂商。此处是策略示例。

STATUS: done
