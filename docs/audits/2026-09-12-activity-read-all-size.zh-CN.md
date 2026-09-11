# 动态全部已读按钮尺寸

上游来源：app.raft.build 已授权冻结资源
`docs/evidence/raft-web-20260908-current/ThreadsInbox-Df4Pr6bf.js`，
SHA256 eedd3aecea38a8d3ac3bc9190d172661b0ce249da5718945629eb68f08e5f701。
定位 `inbox-mark-all-read`：两条渲染分支均为
`btn-brutal-sm inline-flex h-8 shrink-0 items-center whitespace-nowrap bg-white px-2 text-xs font-bold`。

本地此前通用 btn 实测高 38px、字号 13px、左右 padding 14px。
由 apps/web/src/global-discovery.css 单独对该操作按钮采用上游
32px 高、12/16px 字号行高、8px 左右 padding；保留共享按钮交互与业务处理。
属于参数结构移植，不是字节复制；上游资源仅供取证。

scripts/test-activity-read-all-size-browser.mjs 先验证原尺寸失败，
修复后 1440px 和 390px 视口通过。正式构建、git diff --check 通过；
全仓 check 仍受未提交组件规格基线与过期 matched-rules 阻断；
format:check 仍报告 ui-catalog.html 和 build-ui-catalog.test.mjs。
没有将未通过的检查标为通过。

正式实例备份后温和重启，构建
fefcb29d847801052380ac77dc8099645512d67ae9b5ab8ebcb428acb1b73239。
新浏览器实际打开动态页确认高 32px、字号 12px 并检查截图。
本批未重新开展官网同视口现场对照，依据是官方源码与本地浏览器计算值。
未提交 commit，未推送。
