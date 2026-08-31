# 核心交互收口复审 — 2026-08-31

## 结论

**主链具备可运行、可观察、可持久化的验证证据，但尚不能宣称核心页面、全部交互和鼠标行为与 Raft 官网一致。** 缺口仍包含用户每天会碰到的功能，并非仅有视觉尾差。本报告不用总体百分比，也不把代码存在、单测绿色或空页能打开算作功能收口。

## 样本和边界

- Raft 登录后真实页面：同一 hakasemac 空间，test 频道、Alice 私聊、成员动态/资料、Tasks、Search、通知、Computer、Files。桌面对照视口1440×1000，使用同一浏览器，不按缩放截图猜 CSS。
- Raft 当前 Computer / Agents 均显示离线。可核对真实 UI、已有消息与历史动态；**本轮没有得到一组新的 Raft Agent 回复，不能声称完成双边新任务运行的结果等价证明**。官方只作查看/打开/关闭/输入后清空，不创建、修改或删除业务实体。
- 本地4193：隔离数据库及两个 Fake CLI，验证真实 Kernel/Host/Web 业务链，不把 Fake 推理当成付费模型证据。
- 本地4194：隔离身份、数据库及 `/private/tmp/rah-closure-cli-zIjx59`，使用真实 OpenCode 1.18.22 / DeepSeek V4 Flash / max，UI 发起两个消息轮次。
- 本地390×844：同组件窄屏回归；不是 iPhone 真机或 iOS App 对照。本轮不扩大为 Firefox 全量回归或所有 Provider 的新一轮认证。
- 4173：只读新标签加载正式入口，确认新前端构建可显示；没有重启正在运行的 daemon（PID80020）。构建输出目录由该服务直接读取，因此刷新可加载新前端；**新 Host/driver 代码不能据此算已在老 daemon 中启用**。

## 本轮修复

1. OpenCode 依据 `message.updated.info.role` 和 message/session identity 过滤 user part；支持 info/part 中嵌套 sessionID、乱序元信息、有界缓冲。重复 busy 去重，不再把每次 busy 误报成新模型请求。404 重试工具活动证明与诊断过滤分离。
2. Workspace/频道/私信分组使用共享 disclosure，鼠标点击和键盘 Enter 均可折叠。截图审查抓到新增 SVG 未定尺寸的回归，已按官网12×12、gap4、hover黑70%修复。尺寸测试和 DOM 实测均补齐。
3. 频道详情入口改为当前官方的齿轮语义；创建频道自动聚焦名称字段，关闭走共享弹层协议。
4. 搜索空关键词即使有频道/发送者筛选也显示官方初始态，不直接列全部消息。
5. 修复 Search/Task/页面切换卸载 composer 导致草稿丢失：连接级内存 owner 按 Room/DM/Thread 隔离正文及 Task 选择，提交成功只清理相同 snapshot。刷新/断开连接后的草稿持久化不在本次承诺内。

已从前一批继续核验：空间缩写/预设头像、姓名点击提及、头像延迟摘要、移入摘要卡、头像点击默认动态右侧栏、关闭恢复焦点、短动态同行排版、聊天分隔条拖动。详细所有权见[设计文档](../product/identity-and-agent-interactions.zh-CN.md)。没有把整站交互重新手写一份或将 Provider 日志变成消息。

## 实际操作结果

| 范围        | 本轮实际核验                                                                         | 判定/限制                                       |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 创建 Room   | UI创建Closure Review、加入Alice/Kimi、人类发送、两Agent各显式回帖                    | 本地业务链通过；官方创建表单打开/取消           |
| 私聊        | 侧栏直接进入Alice，不先去资料；真实OpenCode DM两次回帖                               | 入口及本地持久化通过                            |
| 姓名/头像   | 官网姓名→@Kimi；头像hover摘要、点击→动态侧栏；本地同样实点                           | 已列行为通过，不覆盖整个消息动作菜单            |
| Thread      | 官网页点击已有回复打开；本地hover工具栏打开、姓名提及、独立草稿、关闭重开、实际回复  | 本地回复只在Thread中；附件/更多操作未齐         |
| 分隔条/折叠 | 鼠标从240拖到320px、键盘Home；分组点击收起、Enter展开                                | 通过；不是所有可拖拽目标的验收                  |
| 导航草稿    | Room→搜索→结果/返回，Task选择保持；Thread关开保持；390px Room/DM来回各保留自己的文字 | 通过；刷新仍是内存草稿清空                      |
| Agent动态   | Alice同时显示频道和DM历史；真实OpenCode显示读写文件、命令、输出与空闲                | 跨Room来源通过；业务工具语义标签仍未全面等效    |
| 模型设置    | 4194经UI选择DeepSeek V4 Flash/max后执行；独立资料页和侧栏都能开配置弹层              | 新运行配置生效；未重新验证每一种Provider/effort |
| Search      | 双边发送者菜单、默认范围、空态；本地排序“最新”、命中结果回到准确Room/消息上下文      | 通过列明路径；不是全排序质量/大历史性能认证     |
| 全局Task    | Human作为任务发送→单次claim→progress→submitted→Human从菜单完成                       | Fake业务链通过；官网菜单只查看；强制改派未实测  |
| 通知        | 双边通知浮层空态打开关闭；本地Human Inbox0项                                         | 只证明空态，不证明Push或全部通知类别            |
| Computer    | 双边读取计算机和Runtime；本地默认需先选Computer                                      | 管理能力/布局仍明显不同                         |
| Files       | 官网说明媒体/文件可拖进composer；本地明示Artifact未接入                              | 未完成，不算空态等价                            |
| 窄屏        | 390px Room、DM、列表、Agent全宽面板、关闭、草稿；document宽390                       | 通过列明用例；未做本轮iOS/Firefox全模块对照     |

鼠标覆盖不包含所有右键、长按、tooltip、拖放、禁用态和取消路径；尤其任务标记、收藏/回应、文件拖放不能宣布一致。

## 后台事实：不是仅截图看到了回复

真实 OpenCode：

| RunAttempt                                 | 结果                                                            | 轨迹                       |
| ------------------------------------------ | --------------------------------------------------------------- | -------------------------- |
| `run_1eb2d483-635c-480b-a902-0ff7f69430a4` | exited / exitCode0；显式回复CLOSURE_ROLE_FILTER_OK和文件路径    | 31条；busy1条；text输出4条 |
| `run_133f2617-9b8a-4ab8-ab32-7684472c2520` | exited / exitCode0；恢复后显式回复RESUME_ROLE_FILTER_OK和原内容 | 16条；busy1条；text输出2条 |

文件读回内容确为 `CLOSURE_ROLE_FILTER_OK`；两个 Human 请求对应两个 Agent canonical message；该隔离库Task数为0。首轮与恢复轮的运行诊断不再把驱动发出的 user 启动输入当成 assistant 输出。模型自己生成的诊断内容可能讨论输入，但不能据此认定又发生role泄漏。

Fake任务 `task_02c9181c-1056-4131-bf23-18c0e1eaa3d5` 最终completed、assignee为Kimi。数据库 `task.created / claimed / started / progressed / submitted / completed` 各1条，验证开放任务单winner。Alice轨迹覆盖2个Room；任务线程回复不是顶层消息。该证据只认证调度和命令链，不认证LLM执行复杂任务的质量。

## 仍未收口：按优先级分层

### P1 — 核心前端对齐

- **消息动作与Task徽章**：本地hover工具栏仅Thread回复；收藏、回应等缺少完整协议/入口。Task源消息仍显示 `Task #1 / completed`，没有官方可点击的 `#1 @Agent` 彩色徽章。Thread预览头像仍有首字母退化，更多操作/自动聚焦也未全部等效。
- **Agent资料语义/密度**：官方“角色”是管理员/成员权限；本地仍展示角色描述文本。Computer友好名称/状态、父子关系、全局/工作区Skills等未齐。动态标题区仍有额外开发说明，边框/按钮间距不全同；不能将同行排版修复等同于整个面板像素级一致。
- **侧栏与历史数据**：尚无完整置顶/排序/联合频道。4173只读样本出现两个同名Codex私聊入口（一个来自Agent目录、一个历史DM入口）；未证明是同一身份，不应简单按显示名去重，需要按canonical participant关系整理/明确标注历史身份。
- **移动端和性能**：当前底部导航较多、文案与Raft不同；大历史/大输出跨全部Provider的可用性还需压力验收。构建存在大chunk警告，主mount包约1.06MB（gzip约309KB），未做此次低端机性能基准。

### P1 — 需要后端合同/产品命令，不是补CSS

- **Agent执行restart/reset/自治控制**：资料按钮仍禁用。已有exclusive fence不是完整操作；需请求、停止/回收证明、新执行或provider会话重置、崩溃恢复、UI结果闭环，明确不删除个人长期记忆。
- **频道管理与个人偏好**：置顶、静音、折叠长消息switch禁用；官方归档、退出、删除、停止频道内所有Agent等管理动作未齐。需要正确区分Human个人偏好和Room管理事务。
- **动态的业务语义投影**：读写/命令轨迹已可见，但许多RAH Worker CLI动作仍显示为通用Running command，没有完整映射Raft的Checking messages、Claimed task、target deeplink等；OpenCode未知role缓冲溢出允许丢诊断，但没有完整的缺失量提示。不能把诊断变成业务truth来补这些。
- **通知/提醒/应用**：Human Inbox + InputRequest有已有合同，但本轮未重跑真实Provider等待/恢复。Agent提醒tab本身标记业务协议未接入；Push、全类别通知、应用目录不是空浮层所能证明的。
- **Artifact/Files**：仍缺完整上传/附加、存储/授权下载、预览、拖入、任务产物关联与交付验收；不应把已有TaskReview记录说成Files系统完成。
- **安全强制改派**：普通任务菜单受审阅/执行事实约束是有意的安全差异。完整强制改派产品链还需独占fence、旧执行停止证明、重分配和旧回包拒绝的端到端验收。

### P2 — 边缘管理与交付

远程Computer添加/配对/命名/编辑/升级/移除的一体管理UI、Agent关系图/邀请入口、完整Skills/App管理，以及跨浏览器全矩阵仍需补齐。本次不宣称Mac正式发布包、远程节点管理或长期稳定性已经认证。

## 门禁与证据

测试按先失败后修复进行。最终 `npm run check` 通过：TypeScript通过，包测试663项（661通过、2个opt-in真实gate跳过），Web单测56项全部通过。`npm run format:check`、`git diff --check`、普通Web构建与最终trusted-proxy workbench构建通过，`npm audit --omit=dev` 为0 vulnerabilities。构建的大chunk警告保留在性能缺口中。真实OpenCode单独经浏览器执行，不混入默认测试数字。

本轮证据目录：[core-interaction-closure](./evidence/2026-08-31-core-interaction-closure/)。重点：`local-final-agent-peek.png`、`local-agent-activity-full.png` / `raft-agent-activity-full.png`、`local-agent-profile.png` / `raft-agent-profile.png`、`local-task-menu.png` / `raft-task-menu.png`、`local-mobile-agent-peek.png`、`local-mobile-room.png`、`production-readonly-smoke.png`。早期`real-opencode-activity.png`保留了本轮中间态箭头尺寸问题，不能作为修复后样式截图；真实执行结果以其中消息/轨迹及数据库核验为证。

验收方法区分：DOM/源规格用于解释和精确参数，真实点击用于行为，截图必须人工查看，数据库用于canonical结果；四者不能相互替代。下一批建议先集中修复消息动作/Task徽章/Agent资料语义，再补频道偏好和Agent生命周期操作；不再以CLI参数调试替代产品收口。

收尾检查：本轮4193/4194临时服务已退出、监听端口已释放；隔离测试数据库随fixture回收，关键事实和截图保留在本报告/证据目录。用户原来的Raft和4173标签保留，临时浏览器视口已恢复、临时对照标签关闭；正式daemon仍为PID80020。本轮没有提交或推送代码。
