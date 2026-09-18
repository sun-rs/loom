# 设置、文件反选与 Agent 动态修复

## 源码证据

复核对象是 2026-09-16 留存的 Raft release/v1.16.0，commit
`ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，不是声称已检查未来更新。
[版本与下载清单](../evidence/raft-release-20260916/manifest.json)。
`https://app.raft.build/assets/index-CKeqacxz.js` SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`；
`https://app.raft.build/assets/AgentDetailPanel-CW_VMZT6.js` SHA256
`918921bbb932ed020285d2f3639c0a5511249f4bca1d2468628da995078a37e3`。
发布包只作静态分析，不执行、不引入生产依赖。采用方式为结构移植加 RAH
绑定，不是复制原始源码。archive-restore 图标是上游 Lucide IKe/l5 几何复用，
保留 ISC 来源注释与现有许可证。

## 设置与文件引用

- Appearance 的 hideEmptySidebarSectionsTitle 卡片紧接模型显示卡片，
  `mt-4 border-2 p-4 shadow-brutal-sm`：独立 2px 边框、16px 间距。
- `Ere/Uc` 开关：整块 pointer，未选 hover `primary-400/30`，选中明黄。
  RAH 修复透明 input 的默认 cursor 和层级，显示轨道不截获点击；频道偏好
  开关采用同样的 hover 规则。禁用态不触发 hover 或写入。
- `Bdt/Fdt/Udt` 已归档频道：仅管理权限显示；空列表隐藏；归档时间倒序、
  同时刻按名称排序；标题计数、灰框行、类型与归档时间、绿色恢复按钮。
  恢复时全部按钮禁用，错误保留并可重试。RAH 仅有公开/私密频道，不虚构联合频道。
- Settings 去除重复计算机入口，保留主导航。
- Agent 聊天目录沿用 Room.visibility，私密为 lock / 私有，公开为 hash /
  公开。上游 AgentDetailPanel 频道列表对公开频道不附右侧标签；这里按用户
  要求显式标注公开。移除目录标题右侧重复粉色私信按钮，保留共享 AgentHeaderActions
  私信入口及其权限、忙态和错误处理。没有重新推断频道权限。
- 文件反选不是 selection 状态没清除，而是 hover 残留。共享 ChoiceRow
  的文件专用 opt-in 在显式反选后抑制残留 hover，重新进入恢复 hover；键盘
  focus outline 保留，不修改其他 choice profile。

已归档名称打开复用 HumanNavigation + 常规 Room 阅读界面。原来的导航 SQL
额外排除 archived，和已有成员阅读权限矛盾；移除此重复排除，保留
requireRoomContentReader（归档频道仍要求成员权限）、写入归档围栏和普通
列表排除规则。取消归档复用 runRoomMutationAtLatest，不跳离设置页。

## 动态规格与本地差异

上游 `loadTrajectoryLog(agentId, limit=50)` 请求 `/agents/:id/activity-log`，
没有小时/天数过滤。`dc` 按轨迹顺序展示，最新位于底部，长度变化调用
scrollIntoView；没有历史分页按钮。`Jo` 隐藏识别为 send_message 的 tool_start。
再次核对同一发布版本：`fqe` 将 hydrate 和实时 trajectory append 去重合并，
按 timestamp/serverSeq 排序后 `slice(-500)`。因此 50 是默认请求条数，
500 是每个 Agent 的前端合并缓存上限，并非固定时间范围或服务端保留期。

| 类型                        | 上游展示                                                               |
| --------------------------- | ---------------------------------------------------------------------- |
| thinking                    | 时间、忙碌点、思考文本；超过 200 字允许展开                            |
| text                        | 时间、青色点、输出标题、文本；长文本折叠                               |
| tool_start                  | 时间、忙碌点、工具名、可选 subagent 标签、纯文本参数；发送工具去重隐藏 |
| slock_action                | 时间、蓝色点、动作标题、RefText 正文                                   |
| system                      | 时间、橙色点、系统标题、RefText 正文                                   |
| status                      | 时间、状态点、状态名称、可选 subagent、RefText 说明                    |
| compaction_started/finished | 时间、橙/绿色点、对应压缩状态                                          |

上游不是给每条轨迹追加一个频道/私聊标签，也不会把所有 Provider 输出都
解析成导航按钮。RAH 因此移除 context 的额外“对话”行，仅系统/平台动作/
状态说明使用已有 DiagnosticReferences。原始 context 仍留在诊断数据中。

RAH 保留既有 50 条初始读取、文本分片合并、受限历史分页与诊断导出；分页
按钮移至列表顶部，初始定位最新，向上滚动才进入视野。加载前记录可见行锚点，
插入较早记录保持阅读位置。历史模式暂停轮询，避免新尾页冲掉历史；不照搬
上游强制跟随底部。该分页为明确的本地扩展，不宣称 1:1。
本次没有新增按名字猜测 RAH 工具调用意义的过滤器，也没有改 Provider 事件
生产、调度、原始轨迹留存或私有思维内容边界。

### 返回最新位置修复

移除历史模式的顶部横条，复用聊天 `.rah-scroll-to-bottom` 按钮。
动态视图拥有定位容器，按钮位于可滚动区域之外、距内容底部 16px，
只在离底部至少 48px 且有记录时显示。打开/切换 Agent 默认定位底部，
向上阅读后不因新增记录强制跳转；点击清除历史锚点、定位底部，并在
历史模式请求最新页恢复轮询。该交互为用户指定的 RAH 改进，不宣称上游
具备同样的历史分页或返回按钮。频道 context 不生成额外标识行的规则不变。

`test-agent-activity-repair-browser.mjs` 先复现缺少返回按钮，再验证 Chromium
和 WebKit 的 1440/390px 初始底部、滚动显示、点击隐藏、历史 prepend 锚点
及回到最新页；共享滚动 owner 回归通过。截图为隔离夹具，不是正式部署。
完整检查仍被后台 `/v1/worker/message-present` 未登记与四个后台文件格式
阻断；此批不重启未经完整验证的正式工作台，也未进行 iPhone 实机验收。

## 验证

文件反选、卡片顺序、开关 hover、频道开关、轨迹额外 context 标签、归档
导航均已先复现失败再修改。定向入口：

- `scripts/test-file-dialog-chrome-browser.mjs`（Chromium/WebKit，桌面/390px）
- `npm run test:web:settings-repair`（外观、整块开关点击、归档失败重试、真实
  Kernel 归档/阅读/恢复/刷新、顶部历史分页与锚点）
- `scripts/test-channel-settings-browser.mjs`
- `packages/kernel/test/human-navigation-notifications.test.ts`（成员可读、外部无权、归档不可写）

本次没有真实 iPhone 原生测试、付费 CLI 或在线 Raft 双边同状态验收；静态
源码核对和本地浏览器验证不能替代这些验收。

### 本次交付结果

- `npm run check`、`npm run format:check`、`git diff --check` 和
  `npm run build:web:workbench` 通过；上述定向浏览器测试、滚动归属与 Agent
  标题栏响应式门禁通过。
  交付末次重跑全量格式检查时，并行新增/更新的
  `docs/product/2026-09-18-batch1-wake-body-delivery.zh-CN.md` 报格式错误；
  本批 UI 文件未报错，该后台文档未擅自改动。故最终全仓格式状态非通过。
- 正式重启前通过活动执行检查，完成并核验
  `~/.rah/backups/pre-restart-beaccd8a-1993-4bac-b376-e19dbd3fbe8a` 备份。
  精确停止原实例后，新实例使用冻结 Web 制品
  `79f48cadc45c1f49a791694ed4b032c2e7da8864dfdcef68d707228ef718ffc8`；
  原 loopback、LAN、Tailnet 监听入口和端口保持不变。
- `scripts/test-settings-repair-formal-browser.mjs` 在正式入口以 1440px 和
  390px 检查独立外观卡片、间距、设置导航、真实频道可见性图标和标签、
  重复私信按钮移除；页面无脚本错误，Room 事件序号未变化，截图已人工检查。
  `scripts/test-composer-formal-browser.mjs` 的正式文件窗口验收通过。
- 本批改动未提交或推送；现有后台调度及 Stop 改动保留。
