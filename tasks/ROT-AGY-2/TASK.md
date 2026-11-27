# ROT-AGY-2：agy 继任首投被误判为 draft-held

现象（pilot-cell @a55fd9cc，已含 ROT-AGY-1）：Super 在阶段边界触发 Leader 换班，继任 agy 会话 loom-e6aaf773-24ff-431f-afd2-582279c4f8bc 的首条交接投递 f4d7282b-689d-40ca-836a-445b523b4add 报 `delivery-stalled draft-held (120s)`，13 分钟后 self-rotation-overdue 失败（继任终端已被回收，ROT-AGY-1 的回收生效）。新启动的会话输入框不应有草稿；疑似把 agy 1.5.18 启动画面里的内容误识为草稿：
- 启动时出现的 "⚠ Sign-in update needed ⎿ Your sign-in is missing permissions … Run /logout to sign in again." 提示块；
- 或 "> Accept-edits mode: file edits auto-approved (shift+tab to cycle)" 这类输入框占位/模式提示；
- 或底栏 "Tip: …"。
只读材料：/Users/sun/Code/loom-pilot-cell/.project/loomd/sessions/loom-e6aaf773-24ff-431f-afd2-582279c4f8bc*.json 与对应 .project/pty/ 目录（若仍在）、notifications.json。不要往 pilot-cell 任何终端输入。

## 要做
1. 定位 agy 的草稿判定逻辑与输入框识别；用真实画面字节（可在你自己的临时目录启动一个 agy 并抓屏，看到同样的 Sign-in 提示；不登录、不发请求）做夹具，写 RED：上述三类提示都不应被判为草稿；用户真实输入的草稿仍应判为草稿。
2. 修复转绿；画面识别要对 agy 版本做最小假设，未知提示默认不算草稿但要记日志。
3. 全量 `npm test`、`npm run lint` 通过（本机直接跑）。分支 infra/rot-agy-2，工作树 /Users/sun/Code/repos/loom-rot-agy-2，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。
所有 CLI 用绝对路径，不改全局配置，不读凭据。
