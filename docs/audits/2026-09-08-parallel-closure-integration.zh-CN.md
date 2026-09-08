# Raft 收口批次：集成审计与剩余差异

日期：2026-09-08。代码起点 `672c596`；本报告对应尚未提交的工作树。仅评审 `rah_os`，未开发旧 `rah`。本文区分本批闭合行为、仍有差异和正式运行验证；不宣称完整复刻。

## 本批结果索引

| 行为                                                           | 实现与专项证据                                                            | 边界                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 多 Thread 寻址、重试、Agent Task 请求 Human 输入、临时审计读取 | [协作核心](./2026-09-08-collaboration-core-closure.zh-CN.md)              | 同 Room 可读不等于可改；无新增审计角色                       |
| 历史与精确消息、成员/handle、任务列表与生命周期                | [Worker 只读工具](./2026-09-08-worker-read-tools-closure.zh-CN.md)        | 有界分页；读不 ACK，不扩大本 Run 写权限                      |
| 普通讨论附件                                                   | [附件链](./2026-09-08-worker-discussion-attachments-closure.zh-CN.md)     | 不要求 Task；上传和显式发布分离                              |
| 闲置 Task 分配、清除与消息转待办                               | [Task 管理](./2026-09-08-worker-task-management-closure.zh-CN.md)         | 只允许本人创建的空闲 Task；不覆盖活跃 claim                  |
| 本人名称、描述与头像                                           | [自身资料](./2026-09-08-worker-self-profile-closure.zh-CN.md)             | 原资料/图片 owner，control Room CAS，与工作 Room cursor 分离 |
| Computer 重启失败恢复                                          | [重启恢复](./2026-09-08-computer-recovery-closure.zh-CN.md)               | 守卫、回退与有限重试，不忽略孤儿运行                         |
| Agent 操作、Task 表单、PWA 图片                                | [页面修复](./2026-09-08-agent-task-pwa-ui-closure.zh-CN.md)               | 保留既有角色数据兼容，新增表单不预设审计角色                 |
| Agent Skills 真实数据源                                        | [Skills](./2026-09-08-agent-skills-closure.zh-CN.md)                      | Codex/Claude 有来源支持；Kimi/OpenCode 明确不可用            |
| Search 空态/清除筛选、图标与双边取证工具                       | [视觉与行为修复](./2026-09-08-bilateral-search-and-icon-closure.zh-CN.md) | 差异图供人眼复核，不是像素通过率                             |

## 独立审计发现

并行作者测试通过后，独立审计继续发现并复现：历史冻结不能依赖可复用的全局 rowid；around 历史后续分页的字节边界会漏消息；默认 Skills 根目录符号链接可越出批准目录；Task 转换冲突错误码不准确；清除 Search 筛选意外重置排序。这些均已有修复与针对性复验，细节见各批证据。

另发现请求等待期间撤销 HTTP bearer 的竞态：JSON 资料更新以及普通附件/Artifact 上传需要在异步等待后、业务提交前复验当前凭据。现已在原 owner 的提交前检查修复，独立 9 项复验通过；上传反例同时验证返回 401、未 completed、无残留 blob/part。详见 [资料及上传权限审计](./2026-09-08-worker-self-profile-closure.zh-CN.md)，不是只修改响应隐藏副作用。

## 集成验证记录

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-parallel-closure`。

- 已执行的三真实 CLI 链：Codex `gpt-5.6-sol`、Kimi `kimi-code/k3`、OpenCode `deepseek/deepseek-v4-flash`，实际均 low。`real-split-chain.log` 通过两个子任务提交、A 返工、Human 接受、文件内容与持久化验证。**这次父任务仍 blocked，不算父任务全部完成。** 后续补强的父任务 gate 不能借用该次通过结果。
- 补强真实父任务验收采用同一隔离状态分段续验：`real-parent-complete-chain.log` 的 580 秒运行完成子任务返工和 Human 接受，但新增验收请求错误地向顶层消息接口传 `threadId`，被协议正确拒绝，整条 test 为失败。已修正仓库门禁为 `threads/reply`。随后从保留状态重启 daemon，真实 Codex low 执行 unblock→退出→下一 Run claim/start/progress/submit。临时续验脚本在结果读取时错误访问 Kernel 私有 DB 属性，未影响此前已落账的 Agent 操作；该失败日志 `real-parent-continuation.log` 保留，不称它为通过。
- `real-parent-final-verification.log` / `real-parent-continuation.json`：独立只读数据库核验不同 unblock/claim Run、本人 actor、唯一父提交和准确文件，再通过 authenticated Human `completeTask` 验收；重开数据库后 3 Task 全部 completed。此最终验收使用 Kernel Human application 方法，不冒充浏览器点击。**完整业务链有分段真实证据；修正后单次全程付费 gate 未重新运行，不能宣称其 exit 0。**
- 前端专项：Search、Agent Skills、Agent 重置覆盖 Chrome/Firefox 桌面与 390×844；冻结 workbench Firefox 及 Chrome 主业务旅程已通过。具体场景由各脚本输出限定，不能推广为官网全页面族一致。
- `final-check-retry.log`：`npm run check` exit 0；包测试 1050 通过、5 个 opt-in 跳过，Web 371 通过，另有 34 回归、11 浏览器策略、3 双边工具测试通过。初次检查因旧 sprite 哈希排除清单遗漏新增图标失败，原日志保留；旧哈希不变，新增图标从实际官方 bundle 的 UTF-8 字节位置提取验证，独立篡改反例也已拒绝。
- `final-freeze-delta.log` 与 `icons-frozen-regression-green.log` 补验冻结末尾的 CLI/prompt 文案及图标校验；没有把修改前通过数当新代码结果。`final-format.log` 和 `git diff --check` 通过。
- 正式构建 `160b0033f8f5786a04b33196e09eb7829d220f87141a1cb0517d5c8a61f599a1`。`final-firefox-workbench.log` 在最终冻结 Web 上通过桌面/移动持久工作台主链；Chrome 主业务旅程见 `chrome-main-regression.log`。

## 正式重启与页面验收

`formal-restart.log` 记录精确原进程空闲检查、备份验证、优雅停止及新进程启动。原 PID 62800，由 PID 55768 替换；备份 `/Users/sun/.rah/backups/pre-restart-5a819be9-bbf3-4562-bda4-2d2e5800a0ad`。正式地址仍为 `http://127.0.0.1:4173`，没有替换成 fixture。

`formal-final-before.json` / `formal-final-after.json` 逐表完整摘要及配置、私有记忆摘要一致：6 Room、43 Message、2 Task、4 Agent、44 Agent revision、396 Room event 和 37 私有记忆文件保持。不是只比较行数。

`formal-browser-after.json`：Firefox 150.0.2 在 1440×900 与 390×844、DPR 2、默认缩放 1 读取新 build，Search 刷新后新空态与无多余清除按钮成立；Agent 展示真实全局/工作区 Skills，Computer 显示当前本机和四个 CLI。六个页面结果、0 未授权请求、0 页面异常，实际截图已查看。首次脚本在移动端选到了隐藏的同名 Computer 标签，改为主内容可见元素后通过；没有改产品隐藏失败。

`bilateral/comparison/search-empty-desktop-after-paired.png` 为官方/正式修后并排图，已人工复核本批空态及按钮差异。保留计数口径与帮助入口差异、浏览器版本差异，不给全页 1:1 结论。

## 未收口：后端

以 [75 路由及表外合同映射](../product/raft-agent-api-contract-map.zh-CN.md)的基线加增量为依据，不以路由数推算完成率。

1. Task 标题/描述修改、真正删除语义尚无完整 owner；不能以 progress 或 closed 冒充。
2. Agent 本人在 Room 的 mute/unmute 尚缺投递偏好 owner；Human 侧边栏静音不是同一功能。
3. 附件评论及定位锚点没有完整 owner；普通消息附件完成不消除此差异。
4. Worker 搜索的发送者、时间、排序等参数尚未全部对齐。
5. Kimi/OpenCode 的 Skills 发现尚未有可靠来源实现。
6. 仅附件且无正文消息转 Task 当前准确拒绝，未取得 Raft server 默认标题语义；没有伪造标题后宣称对齐。
7. Wiki、本机 Integration、通用 Action card 等需继续按具体行为确认适用性；不能以单机或无订阅自动排除。
8. Worker 仍以当前 Room 为边界；跨 Room 目录/runtimeContext、跨 Room/DM target、Agent 自主退出及管理授权尚待完整对齐或裁决，不能归入多 Human 延期。

## 未收口：前端与验证

- 不是所有页面族都完成当前官方版本下的同视口、DPR、缩放、数据形状与状态对照。旧官网截图和源码回放不等于当前双边通过。
- Search 计数口径仍显示消息结果，官网同时包含实体结果；帮助入口等已观察差异继续保留。
- Computer/Agent 的前后截图存在数据数量不同或缩放未知的材料，只能作为差异输入；需补齐条件后再宣称双边验收。
- 付费模型调用新增自身资料、头像等工具未逐项验证；确定性真实 Node 子进程不是付费模型。父任务真实业务链已分段验证，修正验收脚本后的单次全程门禁仍待复跑。
- 真机 PWA 安装、通知与离线，及 MCP 首次配置→分配→实际调用，仍需当前候选的专门证据；已有入口不等于这些使用条件已全部验收。
- 正式重启须核对持久内容和 Agent 私有记忆摘要，不只比较行数；部署不证明全量行为一致。

## 明确延期与不做

多 Human/非成员公开频道、远程其他 Computer、大文件流式待核实仍属于未来项目。中央账户、订阅账单和应用市场不做；语言/翻译/时区页面不在本版本范围。现有本机安装和 launchd 依赖的分发代码保留，不照旧交接稿整体搬入 attic。没有提交或推送。
