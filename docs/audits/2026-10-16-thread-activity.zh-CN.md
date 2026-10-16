# 消息列关注与独立已读组合接线

代码 `cc6375a`。后端冻结不变；合并交付关注／取消关注、可见回复独立已读，并核对执行详情待办，删除已经接入的上下文／压缩缺口误报。

## 来源和组合

官方源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，沿用 FSL-1.1-ALv2 notices 与已有授权。完整组合为 ThreadPanel → PanelHeader actions → ThreadOverflowMenu → raft-ui DropdownMenu／Button／Tooltip。`ThreadFollowMenu.tsx` 选择复用官方触发按钮和关注菜单项的结构、尺寸、图标、文案、弹层位置；省去没有接线的搜索／分屏／来源跳转项。不是整文件逐字复制：本地控制器替换上游 threadStore，经过 Prettier 格式化；固定官方文件未改。

`thread-adaptation.ts` 只为既有只读数据宿主添加 header actions slot；PanelHeader 的标题、容器与关闭按钮保持。菜单 Escape／焦点返回由官方 DropdownMenu 实现。

已读链核对 ThreadPanel 的 live reply read batching 与 MessageTimeline 的滚动容器。后者 `onVisibleMessageWindowChange` 面向翻译，实际包含向下一屏的 overscan，不可作为“已读”证据。本地接线按滚动容器与浏览器视口几何交集收集已加载回复 ID，再映射同 Room／Thread 的真实 roomSeq。页面隐藏、详情被覆盖或读取失败时不推进，不读取完整历史；150ms 合并 DOM／滚动／尺寸通知。Kernel 的 thread-scoped frontier 是唯一业务状态，hook 仅抑制当前挂载的重复请求。

## 数据与失败边界

- `thread.followers` 读取认证 Human 的 following，`activity.follow` 修改。无任意身份参数、无上游业务 store。
- 接口没有幂等键：丢响应只读取 following 核实，不自动重发；读回不符则明确未生效，无法读回则清掉旧状态并禁用修改，提供重新读取。
- `activity.mark` 只发当前 threadId、实际可见回复最大 roomSeq、read／viewport；不发父消息序号、不标 done、不推进父频道。失败可见，同一挂载同一已尝试前沿不自动重发；后续更高的真实可见前沿仍可正常推进。
- 普通消息还没有 Thread 时不因为打开或关注而自动创建。嵌入 Task 详情的隐藏 header 仍没有本次菜单，不声称所有线程宿主都覆盖。
- Agent 关注成员名单／移除／撤销尚未接入；未新增“标记未读”按钮，官方 ThreadOverflowMenu 明确没有该行为。
- 执行详情核对：现有 RunUsageDialog 已展示上下文占用、本轮压缩次数和原生压缩汇总；不再把它们当作待接。全局用量仍待接。held 旧稿修改只有 Worker 能力，没有可直接绑定的 Human SDK 操作，暂不扩展后端或冒用 Worker 身份。

## 验证与部署

- 先新增 controller／header slot 回归并观察失败；此前构建的线程浏览器专项因找不到官方菜单触发按钮而失败。
- 97 项源码／接线检查、受影响类型检查、`npm run build:web:workbench`、格式和 diff 通过。构建仅有既有 chunk／dynamic-import 警告。
- 仅线程浏览器专项：1440×1000 和390×844、DPR1；隔离 Core 中真实创建／回复、丢响应精确核实、丢失关注响应后只读回、已读请求精确线程作用域、菜单 Escape、刷新、桌面拖动分隔线／手机返回、读取失败清正文保留草稿、外频道根消息拒绝通过。首次新菜单断言误用中文，但 fixture 默认英文，已改为官方英文标签后通过；保留失败，不改产品文案。
- 未运行全后端、全浏览器、付费 CLI 或成本实验。没有宣称物理 iOS、五 CLI 或长期成本验收。
- 正式服务先检查活动、备份2库／318文件，再优雅重启 `com.loom.evo`，核对新进程与不可变构建；18张业务表关键投影未变。
- 正式双尺寸打开真实已有消息列，菜单呈现、Escape关闭／焦点返回、截图、构建、无横向溢出与无页面异常通过。没有点击关注项；检查脚本禁止业务写入和被动已读请求，实际未发生被动已读请求。Task／Room列表前后相同。正式只读检查不替代隔离 Core 写入验收。

[结构化证据](../evo/evidence/2026-10-16-thread-activity/summary.json)。原始日志、截图和重启回执位于 `/Users/sun/.loom/reviews/2026-10-16-thread-activity/`。
