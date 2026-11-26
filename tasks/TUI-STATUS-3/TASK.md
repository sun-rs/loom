# TUI-STATUS-3 — Status v2: usable, not a dump (user feedback on v1, 2026-11-26)

Supersedes the v1.1 list (fold those 4 items in). User screenshot of pilot-2 Board: "界面比较混乱".
1. **Mouse**: SGR mouse reporting (1006) — click tabs, click rows to select, double-click/Enter for detail, wheel scroll in lists; restore terminal modes on exit/crash; works in Herdr/hc panes (verify live).
2. **Board = attention summary, not every tab glued together**: health line; "needs attention" list (stalled/refused deliveries in the last hour, awaiting-user, needs-decision, quota/auth, rotation overdue, gates waiting on someone) — empty state "一切正常"; role cards; one-line counts per area (workers active/idle/released, gates open, notices unread) each clickable to its tab. Full tables live only on their tabs.
3. **Workers tab**: default filter = live (busy/starting/idle-retained); released/ended hidden behind a toggle; columns: task, wave (full, content-sized), state with retention countdown ("idle · 释放于 8m"), CLI·model, short id (8 hex, no prefix), age, last result tag (DONE/BLOCKED/FAILED).
4. **Gates tab**: one row per gate round with columns gate, round, verdict badge, who it waits on, age; the verdict's first line in a second dim line; Enter shows full text and paths. No raw "received" transport state in the main row.
5. **Notices tab**: table with columns time (relative), severity (needs-decision/alert/info), kind (human label, e.g. "需要决定", "换班完成", "工具输出占比"), role, summary (display-width truncated); group repeats ("×3"); routine delivery receipts hidden (count only); newest first; read/unread.
6. **Counts are windowed**: Delivery strip shows last-hour counts with an "all-time" detail; `refused 11` must not sit red forever.
7. Short ids are 8 hex without prefix; content-aware column widths; context % filled from the latest native input tokens vs model window.
Same worktree /Users/sun/Code/repos/loom-status-tui (rebase on main first). Snapshot tests at 80/120/200 cols, mouse event tests. RESULT.md section "v2", STATUS: done, uncommitted.
