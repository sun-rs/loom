# Computer 控件与普通侧栏收口

## 上游证据

- 官网 `https://app.raft.build/s/hakasemac` 的 Computer 页面：实际打开停止确认后取消，未停止 Agent。弹窗宽384px，页头关闭32px，底部按钮28px/12px字；文案为“要停止选中的 1 个在线 Agent 吗？它们会停止处理消息。”。上游 Cancel 使用英文，本地沿用中文取消。
- `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js` 的 Na：停止按钮先打开确认，Se/zi 确认后执行 stop；启动为轮廓图标，无额外fill。
- 同目录 `index-BoAC7nSE.js` 的 zi：max-w-sm、p-6、text-sm leading-relaxed black/75及small按钮。复用现有确认框样式 owner（历史类名 rah-channel-confirmation）和 useDialogProtocol。
- `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js` 的 Put：普通侧栏 `_A({storageKey:"slock:sidebarWidth",min:180,max:320,defaultWidth:240})`，非搜索且非实验grid布局共享该宽度，包括Computer和成员。实验grid另有200–420/40vw规则，不拿来替换普通布局。
- 官网扫描提示实测为 `text-xs text-black/40 italic`，计算字体12px；内容为“点击扫描，检查这台 Computer 上的工作区目录。”。

## 修复及边界

- 去除本地启动图标的currentColor实心填充，使用none，白色底透出。
- Computer批量停止在确认前不发操作；冻结本次待停ID，只在确认后调用既有applyAgentStateBatch。取消/Escape不执行，提交期间禁用关闭，失败保留弹窗，重试仍用原有幂等键策略。
- Computer原默认320、范围240–520改为240、180–320；成员原上限400改为320。既有本地宽度偏好键保持独立，越界值按既有策略回落默认。此次未新增实验grid布局。
- 扫描提示按用户要求改文案，字号12/16px、40%墨色和斜体；文件访问边界未变。
- 帮助页底部返回链接已由并发批次移除（见2026-09-12-member-profile-cleanup），本轮仅验证，不重写该页。

## 验证

Computer宽度旧值断言失败；成员恢复旧400上限时真实拖动断言失败；去除fill前图标断言失败；增加确认前等待dialog超时。修复后专项浏览器检查通过。

`test-computer-selection-browser.mjs` 覆盖停止取消、Escape不写入，503失败保留弹窗，确认重试成功；1440/390下停止确认宽度384/358、底部28px，两种重启弹窗规格不混用；扫描文案字号。
`test-computer-sidebar-bounds-browser.mjs` 覆盖Computer/成员默认240，真实指针拖至180/320及键盘上限；字体和初次异步布局稳定后测量，避免把初始零矩形误判为产品范围。

`npm run check`、`npm run format:check`、`git diff --check`及正式Web构建通过。
最后补齐播放图标的2px描边后，Chrome/Firefox专项、UI库规格和格式检查再次通过；截图确认图标没有因fill:none而消失。

正式状态备份到pre-restart-0694b995-3bc6-469e-9e66-924e4919b88e，平滑重启后保留loopback、LAN与tailnet监听。
正式构建23b017da6f82bb9752cabdd555ba5e76724d2030904aeb9ecb207f92b09225e6；
新Chrome页面1440/390实测停止确认及取消、图标轮廓、扫描12px，Computer/成员真实拖动180–320均通过。
帮助页无返回工作台链接，正式截图已检查。成功停止与失败重试只在隔离fixture执行，没有停止真实Agent。

窄屏正式截图复审后补齐共享zi确认框的align-self:center与高度上限，避免继承通用移动端的stretch而撑满页。先确认内容高度断言失败，再修复；Chrome/Firefox双视口及频道设置共享确认框回归通过，UI库、格式和构建复验通过。最终正式页面再次验证内容高度小于400px并查看截图。此最后样式补丁之后未重复全仓业务套件。
