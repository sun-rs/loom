# 任务卡 PILOT-OPENCODE-TUI-1

## 目标与验收

- 交付目标：对 Loom 的 OpenCode TUI 路径（`adapters/opencode/` + `daemon/tui.mjs` + `runtimes/tui/`）完成真实 OpenCode CLI 实测，并保存原生证据：
  1. **冷启动**：通过绝对路径 `/opt/homebrew/bin/opencode`（不经 PATH，不读 OpenCode 配置与 key，用 `-m provider/model` 选择已配置的 provider/model，使用隔离测试目录与隔离 HOME/环境或仅隔离实验项目目录而不动用户全局配置），完成 OpenCode TUI 冷启动与就绪识别。
  2. **5 条排队投递有原生确认**：连续排队投递 5 条带独立 deliveryId 的短请求，逐条核对原生导出/事件确认（0 丢失、0 重复）。
  3. **一次中断续作**：在一次生成中触发中断（`interrupt`），确认中断生效后在同一会话/窗格继续完成后续 1 条请求并获原生确认。
  4. **人工草稿不被覆盖**：模拟人工在输入区输入草稿（保留超过保护窗），触发自动投递，验证自动投递拒绝覆盖人工草稿、原稿保持完整；清除草稿后恢复正常投递。
  5. **必要最小修复**：若实测暴露出 `adapters/opencode/index.mjs` 或 `daemon/tui.mjs` 的确证缺陷（如绝对路径解析、参数格式、miniDraft/classify 识别等），在预算内做最小修复并补 `adapters/opencode/adapter.test.mjs` 单测；若需改动 `loomd` 投递保证/协议语义或超预算，立即停工报 `BLOCKED`。
- 验收标准：
  - 4 项实测全部通过并留存原生日志/对账证据，实验创建的临时会话/pane 全部清理完毕。
  - `node --test adapters/opencode/adapter.test.mjs` 全绿。
- 受影响的测试：`node --test adapters/opencode/adapter.test.mjs` + 运行本卡实测脚本（结果写入 `tasks/PILOT-OPENCODE-TUI-1/`）。
- 制品与原始证据：`tasks/PILOT-OPENCODE-TUI-1/RESULT.md` 及同目录下的实测脚本与原生对账日志（脱敏，不含任何凭据/key）。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-opencode-tui-1`
- 基线：`pilot-1` (`1f529eca`)，当前分支 `wt/pilot-opencode-tui-1`
- 可写范围：`tasks/PILOT-OPENCODE-TUI-1/`、`adapters/opencode/index.mjs`、`adapters/opencode/adapter.test.mjs`、`daemon/tui.mjs`（后三者仅在实测确证需要修复时修改）
- 红线：
  - **严禁读取任何凭据或配置**：不读 `~/.codex/auth.json`、`~/.codex/memories*`、Claude 凭据、agy token、`~/.loom-next/provider-homes`、`.env`、OpenCode 的 provider 配置与 key（如 `~/.config/opencode`、`~/.local/share/opencode/auth*` 等）。
  - 若需调用 `loom`，一律使用绝对路径 `/Users/sun/.loom-cell/current/bin/loom`，严禁使用 PATH 中的 `loom`；所有 CLI 只用绝对路径（如 `/opt/homebrew/bin/opencode`），不经 PATH。
  - 只操作本卡创建的会话与 pane，完成后彻底清理；不碰 Solars、CCP、t17*、t4c、t13n；不改 `pilot-1` 或 `main`；不 push。
- 提交权限：允许在当前分支 `wt/pilot-opencode-tui-1` 上提交干净的 commit。
- 净行数预算上限：220 行（产品代码与测试净增行数；实测脚本与日志放 `tasks/PILOT-OPENCODE-TUI-1/`，产品改动部分保持测试行数 ≤ 产品行数）。

## 停工

预算已超或下一步将超、事实与卡面不符、发现设计缺口、或需要 Super 指定 provider/model 名称而无法无凭据获知时，任一出现就立即停工并报 `BLOCKED`，写明需要的裁决。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-OPENCODE-TUI-1
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
