# 正文引用标识规格与 Raft 控制语义

后续状态：本文记录的检查阻碍已在[删除弹窗与服务确认批次](./2026-09-13-agent-delete-and-service-confirmation.zh-CN.md)按真实源码规格解决；全量检查通过，正文引用修复已随该批正式构建部署。下列“尚未部署”保留为当时的验证记录。

## 证据与实施范围

本批只修改正文引用标识的 CSS，不修改消息解析、权限、目标寻址或生命周期。
维护 owner 为 `apps/web/src/product.css` 的 `.rah-rich-reference`。
这是依据已发布产品源码的结构移植，不是整个 Raft 组件的逐字复制。
原始发布 bundle 仅用于分析，未引入生产依赖；本批没有新增第三方库或更改其许可声明。

Raft Web 来源：<https://app.raft.build/assets/index-MqTUR4Ez.js>，
SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本机可追溯展开文件：
`/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/index-MqTUR4Ez.js.pretty.js`。
实际消息渲染器的 `Lo` 在 141827 行，self mention 在 141878 行，
Task/频道/Thread 分支在 144569–144789 行。
不可拿未被该入口使用的组件库 MessageReference 变体替代实际消息规格。

修复前的双边 DOM、截图与来源记录保存在
`/Users/sun/Code/reviews/rah_os/2026-09-13-inline-reference-audit/`；
该目录是修复前证据，不代表部署后验收。

## 精确规则

| 项目            | Raft 规则及本批结果                                                            |
| --------------- | ------------------------------------------------------------------------------ |
| 行内排版        | `inline-block`，`vertical-align: bottom`；修复 RAH 原来的 inline-flex/baseline |
| 字号            | 正文的 `0.875em`，原本已一致；14px 正文对应 12.25px，16px 对应 14px            |
| 字重、行高      | 700、1.3em                                                                     |
| 边框、内边距    | 1px 黑边，横向 4px，纵向 0                                                     |
| 长内容          | max-width 100%，单行，overflow hidden，ellipsis                                |
| 文本选择        | `user-select: text`，本批补齐                                                  |
| 当前 Human 提及 | 黄色；hover 黄色 80%，本批补齐 hover                                           |
| Task            | 黄色 40%，hover 黄色 100%                                                      |
| Room/频道       | 粉色 30%，hover 粉色 60%                                                       |
| Thread          | 青色 30%，hover 青色 60%                                                       |

普通 Agent 提及并非一律黄色方框；Raft 的 self Human 分支与普通提及分支不同，本批保留这一条件。
这次不能得出“所有弹窗已完全一致”：正文引用不是弹窗，弹窗尺寸须按入口分别验收。

## 验证与限制

新增 `scripts/test-inline-reference-browser.mjs` 和独立源规格对照
`scripts/inline-reference-parity-scenario.mjs`；现有移动布局门禁复用它，取代错误的原始文字基线相等断言。
相同文字、相同字体分别用 Raft 规则与 RAH 生产 CSS 渲染，比较外框、文字上下位置、换行高度、长名省略、文本选择及 self hover。
覆盖 14/16px 正文、180/600px 容器、1440×900 与 390×844 视口。

- 修复前失败：14px / 180px / self，RAH 相对行顶 5px，Raft 6.078125px。
- 修复后独立 Chrome 门禁通过；这证明相同内容的 CSS 几何对齐，不冒充线上同数据双边业务验收。
- 更广的移动门禁中，引用对齐通过；Agent 路由导航在初始重建时测得空框/0，整套门禁未通过。
- 正式 Web 构建曾通过，但共享工作树继续变化；本批尚未完成正式重启与新页面验收。
- 全量 `npm run check` 被其他在途样式阻断：环境变量行 sq-btn 24px 与登记的 28px 不符，另有未登记 SVG 规则和 CSS 证据哈希过期。未降低门禁来放行。
- 最终独立引用门禁、`npm run format:check`、`git diff --check` 通过。正式实例只读 idle guard 通过，但全量检查仍失败，因此本批没有停止或重启正式实例，也没有提交或推送。

## Agent 控制语义

| 动作           | Raft 产品语义                                                         | 源码依据                                                                         |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 停止           | 停止处理消息、停止受管理的运行进程；不等同于删除身份或完成 Task       | Web 81171 `POST /agents/:id/stop`；Computer `stopAgent`                          |
| 重启           | 停止后重新启动，保留运行时会话与工作区文件                            | Web 70875–70892 文案、81213 `reset` 的 `restart` 模式                            |
| 重置会话并重启 | 清运行时会话，重新启动；MEMORY.md、notes 等工作区文件保留             | 同一 reset API 的 `session` 模式                                                 |
| 完整重置并重启 | 清会话并删除 Agent 工作区文件，包括 MEMORY.md/notes，再从空工作区启动 | `full` 模式文案；Computer `resetWorkspace` 真正递归删除 Agent 目录               |
| 删除 Agent     | 删除 Raft 身份及关联平台数据，不是临时停机                            | Web 81189 DELETE 与 70672–70674 文案；外部 Agent 明确不负责停止/卸载外部运行环境 |

Computer 依据为官方 1.0.31 发布物的
`/Users/sun/Code/reviews/rah_os/2026-09-13-raft-1.0.31/slices/packages/daemon/dist/chunk-5Y2HSDGS.js`：
`stopAgent` 33248 行，`resetWorkspace` 33917 行，接收分发 41161–41165 行。
`resetWorkspace` 删除 `join(dataDir, agentId)`；不能扩张解释为删除任意用户项目目录。
发布 URL、哈希与提取过程见 [Computer 1.0.31 核验](./2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)。
已发布版本不等于本机当前安装版本。

删除 Agent 与“删除工作区”有独立 UI/API；Computer 文件列表还能列出 deleted/orphan 工作区。
所以不能从 DELETE 身份接口推断它总会物理清除 Computer 上的所有文件。
未取得中央服务端源码，不能证明完整 reset 调度顺序的事务性或所有文件清理细节。

## Room/频道与关闭操作

| 动作                  | Raft 产品语义                                                                        | Web 展开源码依据                                       |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| SOS 停止频道 Agent    | 对频道内运行 Agent 发停止请求，频道及消息不删除；恢复时要求输入新的指导文字          | 139025–139060，`stop-all-agents` / `resume-all-agents` |
| 归档频道              | 保留历史，禁止发新消息，从侧栏隐藏；可取消归档                                       | 69831 文案，99296 / 99302 API                          |
| 离开频道              | 退出参与；再次加入前不能发消息；已关注 Thread 不自动取消关注，通知仍受可见性条件约束 | 69843 文案，99360 API                                  |
| 删除频道              | 产品契约为永久删除频道及消息，不可撤销                                               | 69851 文案，99276 DELETE；物理附件清理未获服务端证据   |
| 关闭右侧资料/任务面板 | 仅关闭界面，不停止 Agent、不删除 Room，也不等于 Task 的 closed 状态                  | 面板 onClose，与业务更新 API 分离                      |
| 关闭/隐藏侧栏 DM      | 更新 hiddenDmIds，当前 DM 退出到主页；不删除对话或 Agent                             | 134408–134424                                          |

没有证据表明 Room 具有与 Agent 相同的“重启 / 重置运行时会话”生命周期。
频道中的这些按钮若作用于 Agent，应按 Agent 行为解释。
SOS 服务端选择范围与跨频道影响仅凭前端路由不可完全裁决；不能宣称这是无跨 Room 影响的独立暂停通道。
