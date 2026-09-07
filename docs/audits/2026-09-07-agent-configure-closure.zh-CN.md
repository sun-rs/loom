# Agent 配置回执修复与主线剩余边界

日期：2026-09-07。仅针对 `rah_os`。本报告遵循
[单 Human 主线决定](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)，
不恢复旧公开频道施工锁定，也不把旧日期清单当作当前缺失事实。

## 本批收口

发现实际缺陷：配置已在服务端提交，但响应丢失后，Web 保存重试会重新读取 revision、
生成新命令，将自己刚提交的 revision 误判为其他编辑器冲突。

现在两个配置编辑入口共享 `apps/web/src/agent-configure-command.ts`：首次保存仍检查
打开时的 revision；结果不确定时保留完全相同的请求和幂等键，向已有 Kernel 查询原回执。
只有明确的 stale_context 拒绝才能重新同步；未确认旧命令前不能直接换一份配置覆盖。
未新增持久队列、Provider 逻辑或记忆策略。详见[设计与来源](../design/agent-configuration-command.md)。

### 验证

- TDD：确认“自己的新版 revision 阻止回执重试”的预期失败；四项定向测试通过。
- `npm run check`、Web typecheck、`npm run format:check`、`git diff --check` 通过。
- `npm run build:web:workbench`、既有 `npm run test:web:browser` 通过。
- 新增 `npm run test:web:agent-configure`：Chrome / Firefox，各 1440×900、390×844。
  真实隔离 daemon 先提交再丢弃 HTTP 响应，UI 原样重试，确认请求完全一致、回执 deduplicated、
  revision 只增加一次，刷新后 runtime 正确，Agent 身份、角色、明确配置的 instructions 保持。
  已检查移动端截图。种子先补齐生产创建要求的显式 instructions；未改产品的旧数据 fallback。
- 隔离测试使用 fake provider，不调用付费 CLI。已有跨 runtime 记忆测试验证真实子进程和
  文件路径连续性；不等同于本批真实模型记忆验收。
- 未重新进行 Raft 官网同条件双边验收；配置回执算法是本地既有协议的修复，不能称为复制未知 Server 源码。

日志目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-agent-configure`。
新浏览器回执及截图：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-configure-Vi13mG`。

## 当前剩余未收口：按依赖推进

| 顺序                             | 当前事实与缺口                                                                                                                                                                  | 出口                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Agent 配置与运行入口          | 本批只关闭配置不确定回执问题；runtime/model/effort 编辑、执行管理和私有记忆已有实现。完整启动、停止、重置的忙碌/离线/失败 UI 组合与实际 Run 配置对应仍需逐项核对。              | 同一身份从编辑到下一 Run 的配置一致；重启/失败可恢复，不改变私有记忆归属。继续留在此环节。                                                           |
| 2. Room 协作与 Agent API         | Room→Inbox→Activation→RunAttempt→显式行动已有；Human 搜索/reaction 不证明 Worker API 对等。当前 Worker facade 未覆盖 Raft agentApiContract 的全部搜索、reaction、profile 操作。 | 先逐行为确定单 Human 适用项和 Run/Room 权限，再补确实缺失入口；多 Agent 忙时追加、精确归属、失败恢复有当前构建证据。禁止扩大 Worker 凭据范围来省事。 |
| 3. Task/Review 交付              | 单负责人、次级角色、冻结 Submission 和 Review 已有；不能再列作“后端尚未建设”。                                                                                                  | 当前 UI 创建→执行→提交→驳回返工→Human 验收的完整旅程和异常分支，持久状态与显示一致。既有业务 gate 是回归证据，不是所有状态双边认证。                 |
| 4. 相关页面                      | Agent tab 已有接线，但 Activity 的 activityAt 不覆盖每类诊断事件，最近轨迹更新仍有边界；文件菜单/复杂类型预览、错误态及官方非空文件树双边仍未完全验证。                         | 每次一个动作/状态闭环；复用轨迹、文件、共享 UI owner，先来源对照再修，不重造上传或记忆。                                                             |
| 5. 本机 Computer / 必要 Settings | 本机诊断和管理能力已存在；需收口用户入口到恢复结果。部分 Language/Region 设置仍禁用，MCP/帮助各适用项须逐一核对。                                                               | 有真实业务能力才开放操作；保存、失败、刷新可复验。翻译等可选能力先明确首版适用性，不能把禁用等同完成。                                               |
| 6. 首版验收                      | 当前没有全产品同条件 Raft 对照结论，也未在本批运行付费模型。设备通知/PWA、长期运行及完整故障恢复的发布证据仍需补齐。                                                            | 区分自动化、隔离浏览器、正式实例、真实 CLI、官网双边和设备验收；不能相互替代。                                                                       |

明确延期：其他 Human 的加入/聊天/差异化浏览与加入权限；中央账户、订阅、市场；跨互联网
远程 Host 和多机文件传输。不把这些算作首版缺口。保留本机认证、Agent membership 和执行围栏。

上述是剩余工作分类和下一步出口，不是已穷尽的逐行为清单或完成率。每类开工时以源码、
适用行为登记和失败复现继续缩小，避免再从旧报告推导“全部没做”。

## 正式交付

通过 idle 检查并验证备份后，精确停止旧正式进程、启动冻结构建
`9908ea9e911fb9e87ee956882bda7a526d021fa71851a83a6b6d5b74d7eb81a8`。
正式地址为 <http://127.0.0.1:4173>，交付时监听进程为 32089。
备份位于 `/Users/sun/.rah/backups/pre-restart-3e90f8ae-a8e0-46b5-b6b8-51db129eb782`。

正式 `test:web:formal-discovery` 通过，Chrome / Firefox 新页面确认上述 build，保存八张截图，
已检查正式桌面任务页。正式验收是读取与导航，不在用户持久数据中制造配置故障。
重启前后独立快照逐字节相同：6 个 Room、43 条消息、2 个 Task、378 个事件、4 个 Agent、
35 条配置 revision、37 个记忆文件；浏览器自身阅读进度变化由 gate 单独记录。
正式截图及回执位于 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-iUzfio`。
本批未 commit、push 或运行付费 Provider。
