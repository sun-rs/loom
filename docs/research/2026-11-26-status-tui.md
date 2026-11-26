# Status TUI 产品化调研（2026-11-26，只读）

**现状**：`loom tui` → `cli/status-tui.mjs`（224 行，无依赖），原始 ANSI、整屏重绘、每 5 秒 `rpc(dir,'board')`；单栏 `a · b · c` 文本；按码点数换行，中文宽字符算 1 列导致错位、断词；整串打印 Herdr 标签 ID、会话 UUID、路径。

**Solars TUI（用户自己的仓库，只读浏览）**：`/Users/sun/Code/solars/crates/solars-control/src/tui/`，Rust ratatui 0.26.3 + crossterm 0.27。圆角外框带标题、页签栏（数字切页）、单行页脚（状态、刷新时间、按键）；概览页 3×33% 键值面板 + 50/50 + 告警区；表格固定列宽、强调色表头；`:`/`p` 居中命令面板。配色（ui.rs:20-27）：ACCENT `#AE74E6`、ACCENT_DARK `#523E70`、TEXT `#E8E4EE`、MUTED (156,148,168)、GOOD `#5CD69C`、WARN `#EEB95C`、BAD `#EE6C70`、PANEL `#181620`。无许可证声明、`publish=false`、作者即用户，设计可直接借用（代码语言不同不可直接链接）。

**库对比（npm，当日）**：Ink 8.0.0（MIT，React 19 + yoga WASM，~20 依赖，CJK 正确）可用但偏重；OpenTUI 0.9.9 需 node>=26.4 且带原生二进制，否；neo-blessed/blessed 基本停更、宽字符差，否；terminal-kit 依赖重，否；pi-tui 0.73.1（MIT）的 `visibleWidth`/`truncateToWidth`/`wrapTextWithAnsi` 与差量重绘正是所缺；string-width 8 / get-east-asian-width 1.7 是标准列宽原语。可借的版式：k9s 头部键值条与彩色状态列、lazygit/gitui 带标题面板与底部按键条、btop 圆角框与 `▕████░░▏` 计量条。

**结论**：保留零框架渲染器，加一个宽度依赖（string-width 或 get-east-asian-width）+ 约 200 行布局模块（box/columns/table，按显示宽度截断加 `…`、按词换行），注明出处借用 pi-tui 的截断/换行工具，套用 Solars 配色与外框/页签/页脚结构，真彩/256 色带 `NO_COLOR` 回退，只重绘变化行；`--once` 保持纯文本。只有将来需要多面板交互焦点时才考虑 Ink 8（经 htm，无需构建）。ID 列表只显示前 8 位，回车看详情（完整 ID、路径、裁决原文）；窄屏堆叠并隐藏账号与发布块。
