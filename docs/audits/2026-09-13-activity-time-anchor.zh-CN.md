# 动态时间右侧锚点核查与窄屏修复

> 已被[新版时间/按钮替换核查](./2026-09-13-activity-timestamp-action-swap.zh-CN.md)更新：本记录核查的是仍驻留的旧 Web 构建。最新版 `ThreadsInbox-C27ErbNa.js` 已改为同一区域互换，当前正确右距为 14px。下文仅保留为旧版本证据，56px 不再作为当前验收标准。

用户截图指出时间离卡片右框较远。本批先比较实际布局，没有直接改成绝对定位。

## 来源与裁决

冻结证据：`docs/evidence/raft-web-20260908-current/ThreadsInbox-Df4Pr6bf.js`，
SHA-256 `eedd3aecea38a8d3ac3bc9190d172661b0ce249da5718945629eb68f08e5f701`。
`conversation-card-primary` 所在行是 `flex items-start gap-2`，标题 `flex-1`，
时间 `shrink-0 font-mono text-xs leading-5 text-black/40`；卡片 `border-2 p-3 gap-3`，
右侧完成按钮 30px，隐藏时仍占位。该时间行没有按窄屏改为 block 的分支。

Chrome 官网与正式本地页面各取前 8 行 DOMRect：每行时间右缘到卡片右框均为
56 CSS px，包含 2px 边框、12px 内边距、30px 操作位和 12px 间距。
两侧窗口宽度分别约 1087/1098px，均在桌面分支；这是相同布局条件下的几何核查，
不是同视口同内容截图验收。不同长度的时间均拥有相同右缘。
因此用户截图中的桌面空白属于 Raft 同样存在的操作区，不能声称本地多留了空间。

## 修复

真实差异在本地 `activity.css` 的 max-width:760px 分支：卡片内边距改为10px，
标题行改为block，时间单独成行。这与上游无对应条件。
删除这三条覆盖，继续使用现有 Activity CSS owner、时间格式化和业务处理接口。
不增加另一套定位算法，不移动或遮住完成按钮，不改变已读或任务状态。

## 验证

浏览器测试 `scripts/test-activity-read-all-size-browser.mjs` 新增 1440/390px 两档
时间右侧间距与标题行布局断言。旧实现在390px返回 block/54，失败复现；修复后
两档均 flex/56，原全部已读按钮尺寸回归继续通过。官网窄屏本轮未单独实测，
窄屏规格依据冻结源码；不将本地回归冒称双边通过。

类型、UI组件合同、格式、Web正式构建、407项Web单测及后续parity/浏览器策略测试通过。
全仓check包级1572项中1554通过、17跳过、1失败：独立K交接恢复测试返回
UPGRADE_IN_PROGRESS，预期replacement_failed；该文件单独重跑2项通过。
未改动这个无关测试或实现，不将本次全仓命令记作零失败。

已校验备份并优雅重启，保留本机、局域网、Tailscale原有监听。
备份：`/Users/sun/.rah/backups/pre-restart-e4d309ec-cb49-47c7-9b51-b276ac799e6c`。
正式页面build：`f191d9d857dca0bf24512f5c5e38d9b7e561885108cfd7b5f1ec63ece2498d39`。
正式Chrome分别在1440/390px检查前8行：均为flex布局、右距56px，
悬停完成按钮不改变时间锚点；截图经检查。记录在`/tmp/activity-formal-anchor.log`，
截图`/tmp/activity-time-formal-1440.png`与`/tmp/activity-time-formal-390.png`。
本批未commit/push，没有运行付费Provider或发送外部消息。
