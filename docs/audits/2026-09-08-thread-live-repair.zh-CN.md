# 打开中的 Thread 实时更新修复

## 复现与根因

在隔离真实 Kimi K3 low 工作台中，保持 Thread Y 打开，发送 U0908 后 Agent 已将 `U0908 LIVE` 写入正确 Thread。主 Room 预览更新为 7 条，明细仍为 6 条；未通过刷新掩盖问题。

`App.tsx` 的 Thread 读取依赖 `reload`。主 Room 读取还由 Agent catalog / runtime 更新触发，这些更新会清理上一轮 Room effect 的定时器。因此 Room 可以持续同步，而用于触发 Thread 的 reload 定时器被反复取消。不是 Kernel 丢消息，也不是模型未回复。

## 最小修复

打开的 Thread 在 Room 数据提交后也运行既有 MessageSession 增量读取；保留 reload 供主动操作与失败重试使用。没有新增轮询器、历史缓存或游标。引用已读状态查询返回后再次检查 AbortSignal，避免切换 Thread 后迟到结果污染当前面板；历史边界从同一 session 的当前状态获取。

前端 owner 仍是 App 的读取编排；分页、合并与游标 owner 仍是 client-core MessageSession。

## Raft 实景与本地验证

参考官方频道 parity-loop-0908 的既有 Thread Y。19:58 通过浏览器发送 U0908-FIX，请专用 ParityReviewer0908 只回一条；保持消息列打开、不刷新，官方明细自动出现 `U0908-FIX LIVE`，回复数由 6 到 7。

本地同条件使用两个 Agent 所在 Room 的 Thread Y，由专用 Agent（Kimi K3 low）回复相同标记。19:59 已打开的明细自动从 8 到 9，主区预览同时为 9；`DRAFT-U0908` 草稿仍在。截图和辅助功能树已实际查看。两边窗口尺寸不同，本批证明功能更新合同，不声称逐像素视觉对齐。

本地隔离端口与其他工作台共享浏览器 cookie 曾产生会话更新提示，单独记录，不把该提示当成 Thread 缺失原因或本批已修能力。官方初次 U0908 实验期间另一施工会话也在操作 Firefox，因此只把协调释放浏览器后的 U0908-FIX 计作保持打开的双边证据。

## 自动化与交付

新增 Thread 编排依赖回归测试，修复前确认失败、修复后通过；Thread 历史及 MessageSession 聚焦回归 14 项通过。全套检查、构建与正式重启结果见本节最终记录。

最终结果：`npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 全部通过；`npm run test:web:message-timeline` 通过（10,050 条逻辑消息、27 个 DOM 行、锚点偏移 0，覆盖 1440×1000 与 390×844）。该 gate 是既有时间线回归，不替代上面的真实 Thread 到达实验。切换 X / Y 后各自回复仍独立，Y 的草稿保持。

正式实例按空闲检查、备份、优雅停止流程由 PID 43150 更换为 53002；冻结 build `ddceb87eaf669d437dea3517cd8f466fc713163ae0393304a5db84c35a9b71f3`。正式地址 `http://127.0.0.1:4173` 已用新浏览器页面打开原 Room 与 Thread 并检查截图。与备份逐行核对：43 条消息、6 个 Room、16 条 Membership、4 个 Agent 定义及 48 条修订均保持；已检查的 5 个 MEMORY.md / notes 文件内容一致。备份为 `/Users/sun/.rah/backups/pre-restart-c718fdf2-0786-4d41-b3d9-aea73c727c23`。隔离 4197 服务已在空闲后优雅停止。

日志与持久性核对：`/Users/sun/Code/reviews/rah_os/2026-09-08-thread-live-repair/`。未提交或推送 Git。
