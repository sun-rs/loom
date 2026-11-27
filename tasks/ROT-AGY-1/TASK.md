# ROT-AGY-1：agy 继任 Leader 的首条交接投递卡在 waiting-writable

现象（pilot-cell，release 812270f0，agy 1.5.18 TUI，Herdr 放置）：Leader 自助换班两次失败（self-rotation-overdue）。继任会话 loom-44fff2c4…40484be4（终端 t3n8）与 loom-5f88388a…754a0f67（t3nd）都已启动并显示 agy 欢迎屏与空输入框，但首条交接投递（如 06284501-c3a5-4d9e-97ca-a2b84802ed63）一直是 delivery-stalled / waiting-writable，直到超时。pilot-cell 首任 agy Leader（t3kg）当初启动正常。只读材料：/Users/sun/Code/loom-pilot-cell/.project/loomd/sessions/loom-5f88388a-cadc-4be0-880b-b586754a0f67.json、notifications.json、.project/pty/pty-KEoQ3d/。不要往 pilot-cell 的任何终端输入。

## 要做
1. 先定位：agy 继任会话的"可写"判定依据什么信号（hook、屏幕识别、holder 状态），为什么首任能过、继任过不了（compactHandover、Herdr 放置、release 差异、agy 欢迎屏/Accept-edits 横幅等）。在 RESULT.md 写清根因与证据。
2. 写 RED：用 agy 真实欢迎屏字节流（或固定夹具）复现继任首投卡在 waiting-writable；修复后转绿。
3. 修复后，换班失败要回收：失败的继任会话由 loomd 关闭并释放终端（现在 t3n8、t3nd 两个空闲 agy 会话留着）；修复里包含这条及测试。
4. 全量 `npm test`、`npm run lint` 通过。分支 infra/rot-agy，工作树 /Users/sun/Code/repos/loom-rot-agy，显式路径提交，不 commit -a。结果写 RESULT.md，以 STATUS 行收尾。Codex 周额度紧张，请求精简。
