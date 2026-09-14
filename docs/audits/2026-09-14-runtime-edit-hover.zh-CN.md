# 运行时配置编辑图标：悬停无底色

用户要求仅移除运行时配置铅笔按钮的鼠标悬停背景。
Raft 来源：`https://app.raft.build/assets/AgentDetailPanel-CVJr5D-b.js`，
SHA256 `e42e78339874cc0d43165b1005d8c246824c399d394eec826492abbe73615afb`；
分析副本 `AgentDetailPanel-CVJr5D-b.js.pretty.js` 6039–6046；
对应按钮是 `text-black/40 hover:text-black transition-colors`，12px pencil，没有背景状态。
本批为参数采用与 RAH 样式接线，不复制上游 bundle，不新增第三方资源，沿用既有资源 provenance。

原问题是按钮同时使用 `rah-profile-edit` 与 `rah-interaction-flat`，两者都有灰底 hover。
运行时配置按钮改用共享 profile 样式中的 `rah-profile-edit-plain` 变体，移除 flat 家族；
profile hover 背景规则明确排除此变体，仍保留图标颜色反馈。其他编辑入口保持现状。
点击回调、权限禁用和弹窗键盘协议不变。

验证先复现 hover 背景 `rgba(0,0,0,0.05)`，再修复并检查全透明。
`scripts/test-runtime-edit-hover-browser.mjs` 在隔离的真实 Chrome + 临时 Kernel fixture 中验证
静止/悬停背景、真实指针点击、Enter 打开、Escape 关闭与焦点归还。
源码接线测试 `apps/web/test/interaction-state-protocol.test.ts` 同步记录这个明确变体。

## 交付证据

`npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 全部通过；两个共享组件规格浏览器门禁和目录生成通过。
专项浏览器测试与交互接线测试均通过，已人工查看悬停截图。

正式构建：`7fa3e7df41040243fc514576e57ff292d5892819519f7b812d9755e2d3e63561`。
并行交付已将正式进程38392平稳替换为46825，独立监督进程46740的参数与构建一致，
备份 `/Users/sun/.rah/backups/pre-restart-4e352ecd-cb69-49a0-9064-9b22ec098e00` 的receipt已核对。
本批未重复中断该新实例。

独立Chrome会话在本机、局域网和远程访问三个正式地址验证构建、真实悬停透明背景、
点击打开配置弹窗、Escape关闭及焦点归还，页面异常为零。测试未保存配置、启动Agent或调用付费CLI。
证据：`/tmp/rah-pencil-check.log`、`/tmp/rah-pencil-browser.log`、`/tmp/rah-pencil-formal.log`；
截图 `/tmp/rah-pencil-formal-127.0.0.1.png`。
未提交或推送；没有宣称全产品或Raft同视口双边验收。
