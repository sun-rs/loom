# 任务多选、共享间距与筛选生命周期（2026-09-15）

## 来源与边界

Raft 授权参考 https://app.raft.build，vendor build
`666bab60d8658d9e382e2c286ce1e423231e8f31`。维护的
`packages/ui-tokens/src/neo-brutalist/extracted/raft-official-tasks.css`
记录 toolbar gap 8px、view gap 4px，源自 Tasks DOMRect/computedStyle 与发布 utility。
既有全局 Tasks 移动端 toolbar 6px 是 RAH 本地适配，不冒称上游提取参数。
本次把 Room 两组间距对齐全局页面，复用 DiscoveryFilter 多选、count badge 与 taskPersonOptions。
无新增 bundle 提取，沿用原授权来源及维护 token。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/filter-chips-bar.tsx` 是独立筛选 chip 布局；
没有替换既有共享选择器的优势，不导入其 view store。

本次用户要求取代此前 [单选与 8px 移动布局适配](2026-09-15-pwa-task-filter-spacing.zh-CN.md)；
该记录的触屏菜单关闭边框修复继续有效，单选/隐藏计数部分不再代表当前行为。

## Owner 与可观察行为

- Room TaskPane 只持有该访问的选择数组：同字段 OR，创建者与负责人间 AND。
  未分配沿用 `unassigned`。筛选不改变服务端任务状态。
- TaskToolbar 与全局任务复用 DiscoveryFilter，多选勾选后菜单保持打开，支持 Escape、外部关闭与清除。
  选择数显示在按钮中，按钮自然增宽。PWA 极窄且有计数时使用单行横向滚动，保持间距及完整文字。
- App 聊天列表进入 Room 时重置 chat 页签，TaskPane 以 Room ID 分隔组件身份；
  同 Room 的人员资料/消息列覆盖层不会主动清除筛选。
- 全局任务选择由 App 的工作区级内存 map 保存，仅含频道/创建者/负责人；
  GlobalDiscovery URL 和查询仍使用同一份选择。导航离开再回来恢复，reload 清空；
  不保存 Task ID、消息目标或业务响应。不使用 localStorage/sessionStorage。
  首次显式带筛选 URL 导航仍可接受，浏览器刷新时仅清筛选、不破坏任务详情深链。

## 验证

TDD：数组匹配测试先在旧实现失败；会话恢复测试在 owner helper 缺失时失败；
浏览器先复现 Room 不支持 checkbox、多选和全局导航丢筛选。
Chromium/WebKit 专项均通过（1440×900、390×844），涵盖多选、计数自然增宽、
两级 gap、窄屏操作可达、跨频道/私聊/大页重进清空与全局筛选跨导航保留及刷新清空。
浏览器测量等待 Room 追赶完成与创建入口可用，避免把临时组件的零宽度误当成按钮尺寸。
触屏菜单边框回归覆盖 390/430/1440px；移动导航、空结果轮询稳定性、卡片原生触摸滚动回归均通过。

`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 均通过；共享组件 CSS 证据及 catalog 已更新。

正式实例已完成空闲检查、持久状态备份、优雅停止和冻结资源重启；新构建为
`7d36a7f3398b5343d2ab6ff618b740c0c18f5fcf4e831cd9d7ca403301064270`。
原 Tailnet/LAN 两个入口均通过新浏览器页面验证构建标识及上述筛选行为；已检查正式 Solars
频道 390/1440px 截图。此验证只操作导航与筛选，不创建任务、不发送消息。

本轮不声称实体 iPhone 或上游同条件双边验收；未运行付费 CLI，未提交或推送。
