# 成员整行光标与头像悬停

Raft 发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，授权分析副本
`2026-09-13-dialog-audit/index-MqTUR4Ez.js.pretty.js` 的 zg（139252–139349）。
Human/Agent 共用成员行：资料入口使用可点击按钮，头像在存在 onAvatarClick/onRowClick 时
附带 `transition-colors hover:brightness-90`。头像亮度是90%，不是整行透明度；
`transition-colors` 不包括 filter，因此亮度直接切换。整行原有黄色悬停继续保留。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/common/actor-avatar.tsx:191,332–333` 同样显式设置 cursor-pointer，
但采用自己的圆形头像与HoverCard，未采用其视觉规则。

本项按Raft参数结构移植，没有复制资源或修改冻结快照，沿用现有来源记录。
唯一修改所有者为 `apps/web/src/room-member-pages.css`：有资料按钮语义的成员行
使用 pointer，直属头像仅在自身 hover 时应用 brightness(0.9)。字母、像素、上传图片
头像共用现有 role=img 边界。没有改变资料导航、成员移除、权限或业务状态。

## 验证

先扩展 `scripts/test-room-member-layout-browser.mjs`，复现旧 Human 行
cursor 为 auto 而非 pointer；随后修正CSS。Chrome/Firefox通过：Human与Agent行空白处
手型，头像指针与90%亮度，离开头像后恢复且仅悬停行时头像不变暗；既有资料返回、
移除按钮、键盘聚焦、确认取消/失败恢复、390×844布局和添加成员检查继续通过。

`npm run check` 的库规格、类型、Kernel/集成和Web单元阶段通过，随后在同期动态导航
改动的一项旧fixture失败：message.context 返回空对象。将测试返回值补齐为原断言指定
的room/reply/root，未修改原导航断言或产品逻辑；重新运行 parity regression 34项通过，
并补跑通过formal-browser-policy及bilateral-captures。没有把首次全命令失败记为通过。
格式、diff、正式Web构建、sidebar-row/sq-btn规格证据与catalog均通过。
同期 `test-message-location-entrypoints-browser.mjs` 仅作Prettier格式整理。

正式实例空闲校验通过后完成备份和优雅重启，备份目录：
`/Users/sun/.rah/backups/pre-restart-0af43a95-4792-4262-a49e-1371974e4a17`。
实际冻结构建：`fbe9d70959e23e49e2954c8040b66ee1eac276a85cff91897c25dddaac28bc7f`。
新浏览器真实成员页验证Human/Agent指针与头像亮度、移走恢复、头像点击打开资料、
返回成员管理、390px布局与刷新；本机/LAN/Tailnet同一构建均通过。
已检查 `/tmp/rah-member-pointer-formal-agent.png` 截图。
没有移除成员、发送消息或执行付费CLI；未宣称同条件Raft双边在线验收。
