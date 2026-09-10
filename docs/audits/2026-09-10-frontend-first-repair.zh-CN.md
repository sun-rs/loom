# 前端首批差异修复

本批从 `4c80661` 开始，不代表所有前端页面已对齐，也不涉及后端 Runtime/Task 六组差异。

## 来源与范围

双边 Chrome 证据位于 `/Users/sun/Code/reviews/rah_os/2026-09-10-chrome-bilateral/chrome/`，相同 1280×800、DPR 1。原目录的 iab 预检不作为 Chrome 验收。

| 差异                                                                 | 本批处理                                                                                | 证据                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 关系图遗漏零连接 Agent、Human 头像过小、标题结构                     | 复用已认证 Agent 目录补节点；边仍来自可见 membership；36px 圆形；共享标题＋EXPERIMENTAL | Chrome 22；[关系图合同](../product/2026-09-02-member-relationship-graph-contract.zh-CN.md)第 8 节 |
| 动态绝对时间                                                         | 仅动态页采用官方相对时间阈值，不改变搜索日期                                            | Chrome 03；下述 ZVe 来源                                                                          |
| Computer 行展示连通性而非版本、创建 Agent 显示机器 ID                | 行展示实际 `buildVersion`，连通性仍由状态点表达；创建表单使用 Computer 名称/hostname    | Chrome 06、41；不伪造 Raft 版本                                                                   |
| 搜索发送者通用图标                                                   | 使用共享 ProfileImageAvatar 与已认证实体目录                                            | Chrome 36                                                                                         |
| Agent 顶栏私信隐藏、创建表单必填星号换行、无计数、Runtime 无高级折叠 | 恢复入口，标签同行与实时计数，原配置状态保留、推理强度放入高级                          | Chrome 15、21、41                                                                                 |
| Reminder 空态缺指导                                                  | 补官方空态文案；几何仍未签收                                                            | Chrome 18、官方 `emptyState.noRemindersDesc`                                                      |
| Thread 空态、反应浮层定位、相关图标                                  | 共享空态、右对齐、官方 SVG 参数                                                         | [Thread 修复证据](2026-09-10-thread-chat-visual-repair.zh-CN.md)                                  |

动态页来源：`https://app.raft.build/assets/ThreadsInbox-Df4Pr6bf.js`，SHA256 `eedd3aecea38a8d3ac3bc9190d172661b0ce249da5718945629eb68f08e5f701`，保存于 `docs/evidence/raft-web-20260908-current/`。它导入主 bundle `j as et`，用于动态卡片时间。主 bundle `index-BVfbaScj.js` SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde` 的 `ZVe/Vae` 使用分钟/小时/天与 `Math.round`、`Intl.RelativeTimeFormat numeric:auto`。本地为结构移植，仅固定中文产品 locale 和可注入时钟。

## 验证边界

- 关系图 Kernel 与真实 Chrome fixture、Agent 组件 Chrome fixture均执行先失败后通过；1280 与 390 两种宽度通过。
- Thread 与搜索/Computer 接线有合同回归；合同测试不等于业务真实浏览器验收。
- 相对时间测试覆盖分钟/小时/天边界、取整、未来与无效输入。
- 独立只读复核未发现本批扩权或配置丢失；关系图继续复用目录的全量读取后截取 500，输出有界但查询尚未分页，保留为规模边界。
- 全量检查发现新增 SVG 改变冻结哈希；已为三个新增符号单独冻结，原 sprite 基线哈希不变。
- 整体检查、正式构建、正式重启与浏览器复核结果在本轮最终汇报中单独注明，不能从上述组件测试推出。

## 未收口与排除项

- 频道行 hover 铅笔保留待明确入口裁决；不偷偷删除唯一编辑入口。
- 外观字号控件、预览状态点、About 卡片、Reminder 几何、创建与重置弹窗完整参数仍待修复；本批不宣称整个 Settings 对齐。
- Task 历史排序及旧/新状态节点、已提交 Task 负责人编辑仍需按业务合同处理，不能以改 CSS 或倒转当前页伪装闭环。
- 文件预览双边成功条件、Kimi Skills 能力、Computer 创建者资料仍未签收。
- 语言、翻译、时区、MCP、订阅按用户范围排除，不能重登记成首版缺口。Computer 边栏宽度有持久化状态差异，未擅改默认值。

## 本轮最终验收

- `npm run check` 最终全链通过；`npm run format:check`、`git diff --check` 通过。原有八份 Markdown 的格式问题仅规范化排版。
- `npm run build:web:workbench`、`npm run test:web:browser` 通过；两项新增 Chrome 组件门禁由主 Agent 重跑通过。
- 正式工作台通过既有重启脚本检查空闲、验证备份并优雅重启，沿用原持久目录；未提交 Git、未调用付费模型。
- 正式浏览器 meta 验证构建 `4f699c8667b4ce32921baa13a76230865e97fcfbc21f6afc4d4fbd458f671339`。本次正式 Chrome 视口为 1098×1172、DPR 2，不把它声称为新一轮同条件 Raft 双边对照。
- 正式页面确认零连接 Claude/Codex 节点、4 Agent/1 Human、Human 圆形头像、Computer v0.1.0、顶栏私信入口、发送者真实头像。Thread 空态截图目视检查；reaction 浮层宽 224px，trigger/popup right 都为 1050px，bottom=102→top=106，Escape 后 menu 数量为 0。
- 截图保存于 `/Users/sun/Code/reviews/rah_os/2026-09-10-frontend-repair/formal-graph.png` 和 `formal-thread.png`。以上不等于新一轮真实模型工作流或全产品双边验收。
