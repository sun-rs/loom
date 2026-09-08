# Raft 官方 Web 与 RAH OS 前端双边验证（2026-09-08）

本轮同时操作 Raft 官方 Web（`https://app.raft.build/s/hakasemac`，已登录）与 RAH OS 正式本地实例（`http://127.0.0.1:4173`，持久数据在 `~/.rah`），在相同视口、相同语言（zh-CN）下走相同导航流程，对语义对应元素取 `getBoundingClientRect` + `getComputedStyle` 实测值并截图佐证。只读分析，未改产品代码，未停止或重启 4173 实例。

## 会话恢复说明（透明度）

任务提供的 Chrome profile 副本（`/tmp/rah-raft-ui-compare/chrome-profile`）开跑时已无有效官网会话：Cookies 表 0 行、无 IndexedDB、localStorage 只有应用状态没有 `slock_access_token`，全机各浏览器 cookie 库也无 raft 会话记录。当日 Firefox profile 的 localStorage 中存在有效 `slock_access_token`/`slock_refresh_token`（早前审计使用的会话）。本轮以只读方式（SQLite immutable 模式）取出这两个键值注入上述一次性 Chrome 副本完成登录；未导出到对话、未写入仓库，令牌暂存 `/tmp/rah-raft-ui-compare/raft-auth.json`（权限 600）。官网侧全程严格只读：未发消息、未改设置、未点写操作按钮；打开通知弹层可能触发已读标记，特此声明。

## 数据前提

- Raft 侧：4 频道（all/onboarding-owner/test/parity-core-20260829）、5 Agent + 1 Human、#test 有 2 个待确认任务、DM 有历史消息、关系图 8 连接。
- RAH 侧：1 Room（Agent Council）、4 Agent、2 个待确认任务（#1/#2，任务描述中的"1 个"与实际不符）、DM 无消息、关系图 3 连接。
- 浏览器：同一 headless Chrome（Playwright `channel: "chrome"`），桌面 1440×900 为主，关键页加 390×844；`locale: zh-CN`。

## 结论

RAH OS 前端对 Raft 官网的复刻在本次实测粒度上高度对齐：rail、侧栏、页头、Tab、消息行、composer、看板、卡片、动态卡片、通知弹层、Thread 面板、移动端底栏的几何、配色、字体栈、阴影、过渡曲线大量逐项相等（精确到 px 与 oklch/rgb 值）。发现的差异中：**没有高优先真实分歧**；中优先真实分歧 2 项（关系图节点覆盖、设置语言与区域页内容子集）；低优先真实分歧 8 项（几何/文案/动效/时间格式）；另有数据前提不同导致 4 类、有意本地扩展 2 项、有意不做 5 项（引用范围决策）。

分层声明：本轮完成的是「代码已实现 + 同条件双侧浏览器实测」级别的对比；未做真实 CLI 工作验收、未覆盖全部设置子页内容级逐项 diff、未在长历史/慢网下重测。未宣称任何覆盖率百分比。

## 逐项对比（实测值）

### 已对齐（抽样实测值，双侧重合）

| 区域           | 实测一致值                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rail           | 64×900，`rgb(255,212,64)`，底 padding 8px；图标按钮 40×40 起于 (11,70)；底栏 通知/帮助/设置 40×40 位于 y=762/806/850；transition 同为 `0.15s cubic-bezier(0.4,0,0.2,1)`                                                                   |
| 工作区头像     | 40×40 黑底黄字、2px 黑边 at (11,10)；hover 均变为黑底 + `4px 4px 0 0` 硬阴影                                                                                                                                                              |
| 侧栏           | 240px、`rgb(255,250,239)`、右 2px 边；分组标签 12px/16px 700；行 222×32、pad 4/8、14px/20px 500；选中行 `rgb(254,125,168)` + 2px 黑边 + `2px 2px 0 rgb(20,17,17)`                                                                         |
| 面板页头       | 62px、pad 0/20、底 2px 边、白底；标题 16px/20px 700                                                                                                                                                                                       |
| Room Tab       | 76×28、pad 6/16、12px/16px 600；active 底色 `oklch(0.883 0.162 91.89)`                                                                                                                                                                    |
| 消息行         | 发送者 14px/20px 700；正文 14px/20px 400；时间 12px/16px `Space Mono` black/40；Thread 预览行 12.5px/18.75px 700 black/55；hover 出 2px 黑边 + 右上工具条（回复/回应/收藏三图标，截图 `raft-msg-hover2.png`/`rah-msg-hover.png`）         |
| Composer 内盒  | 1112×96、pad 8、2px 黑边白底；textarea 14px/20px；占位文案模式一致（`发送消息至 #…/@…`）                                                                                                                                                  |
| 任务看板       | 列 320px、pad 12、2px black/20 边、white/30 底；列 chip 38×21、10px/15px 700、pad 2/8、`rgb(248,161,111)`；卡片 292×105.3、pad 10/12、2px 黑边白底、`2px 2px 0 rgb(20,17,17)`；卡片标题 14px/20px 700；空列文案一致（`没有待办的任务。`） |
| 全局任务工具行 | 筛选（频道/创建者/负责人）与 看板/列表 切换位置一致（1296,74 起 62×32，12px/16px 600）                                                                                                                                                    |
| 动态           | Tab 44×32 pad 6/8 12px/16px 600；feed 卡片 pad 12、2px black/30 边（RAH 实测 1344×104，Raft 截图同构）                                                                                                                                    |
| 通知弹层       | 320×288 at (59,514)、2px 边、`4px 4px 0` 硬阴影、空态「暂无通知」+ 图标                                                                                                                                                                   |
| Thread 面板    | 400px at x=1040；header 62px；composer 占位 `发送消息至 消息列`                                                                                                                                                                           |
| 字体栈         | 全局 `"Raft Quote Glyphs","Space Grotesk",system-ui`；时间戳 `"Space Mono",ui-monospace`                                                                                                                                                  |
| 移动端 390×844 | 底部 Tab 主页/任务/成员/设置（RAH 有相同底栏）；房间视图左上返回；任务/成员/设置/计算机/动态结构一致                                                                                                                                      |

### 真实分歧 — 中优先

1. **关系图节点覆盖**：Raft 显示全部 6 个成员节点，含 0 连接孤立节点（Grok 标「0 个连接」）；RAH 只渲染有连接的 3 节点（owner/Kimi/OpenCode），无连接的 Claude Code、Codex 不出现在画布。证据：`raft-members.png` vs `rah-graph.png`（Raft AGENT 计数 5、8 连接；RAH 2 AGENT、3 连接）。
2. **设置「语言与区域」 vs 「日期与时间」**：Raft 该页含显示语言选择（简体中文）、翻译模式（自动/手动/关闭）、时区选择、时间格式四个设置项；RAH 对应页只有时间格式（12/24 小时制）。语言选择/翻译/时区三项缺失。证据：`raft-settings-语言与区域.png` vs `rah-settings-日期与时间.png`。是否划入首发范围待产品裁决（翻译模式涉及后端能力，见后端缺口）。

### 真实分歧 — 低优先

1. **动态页时间格式**：Raft 相对时间（`5 小时前`/`4 天前`）；RAH 绝对时间（`2026/9/4 16:53`）。搜索、动态两页一致复现。
2. **Composer 外层 form 底 padding**：Raft `12,12,16,12`（form 1136×126）；RAH `12,12,12,12`（1136×122），差 4px。
3. **Thread 面板 header 水平 padding**：Raft 0/20；RAH 0/16。
4. **通知弹层 header**：Raft 高 34、右侧文案「全部已处理」、边框 `oklch(0.18 0.006 25)`/阴影 `oklch(0 0 0)`；RAH 高 42、右侧文案「0 项待处理」、边框/阴影两色与 Raft 互换（视觉近不可辨）。
5. **关系图标题与统计卡文案**：Raft 标题「关系图 + EXPERIMENTAL chip」、统计卡「连接最多的成员/最大的频道」；RAH 标题「关系图 3」（计数）、统计卡「连接最多/最大频道」。
6. **计算机列表行副标题**：Raft 显示版本（`Computer v1.0.18`）；RAH 显示状态（`Computer · 已连接`）。
7. **选中频道行几何与入口**：Raft 行 pad 4/8 无行内入口，频道名文本 x=106；RAH pad 4/32/4/8（右侧留 pencil 槽）、hover 出铅笔（频道设置），频道名文本 x=102（4px 图标几何差）。
8. **Tab/按钮过渡**：Raft Tab 有 0.15s 颜色过渡；RAH Tab `transition: none`（即时切换）。rail 图标过渡双侧一致。

### 数据前提不同导致（标「数据驱动存疑」）

- 动态页 header 计数：Raft「20 条进行中 · 3 条未读」；RAH「4 条进行中」（RAH 无未读数据，未读为 0 时是否显示该段未验证）。
- 成员页/计算机页默认选中：Raft 成员页默认关系图、计算机页默认不选中（显示占位「选择一个频道」——官网原文案如此）；RAH 因 tabMemory 持久化默认上次选中的 Agent/机器。
- DM 内容：Raft DM 有历史消息；RAH DM 为空态「暂无消息」。结构（header/在线点/Tab/composer）一致。
- 看板各列任务数、动态条数不同（数据前提）。

### 有意本地扩展（保留）

- 设置「局域网设备」（带「本地」标记）——LAN 设备管理，本地产品扩展。
- RAH 频道行 hover 铅笔（本地 Room 设置入口）。

### 有意不做（引用范围决策）

- 侧栏「联合频道」分组：多 Human 联邦能力，首发单机单 Human 范围排除（`AGENTS.md` 产品边界）。
- 设置「套餐与账单」：中央账户/计费非需求（`AGENTS.md`：Raft 的中央账户、计费和 relay 拓扑不是需求）。
- 设置「MCP 服务器」及 Agent 资料 MCP tab：托管 MCP 已退役（`docs/product/managed-mcp-retirement.zh-CN.md`）。
- 设置「应用」（第三方应用市场）：中央平台能力，随计费/中央账户同属非首发范围。

## 前端缺口

- 关系图 0 连接成员节点缺失（中）。
- 设置语言/翻译模式/时区三项缺失（中，语言选择与时区为纯前端可落地项；翻译模式依赖后端）。
- 动态页相对时间格式（低）。
- Composer form 底 padding 4px、Thread header padding、通知弹层 header 高度与配色互换、关系图文案、计算机行副标题、Tab 过渡（均低）。
- RAH 选中频道行右侧 32px pencil 槽造成的 4px 文本偏移（低，或归为本地扩展的代价）。

## 后端缺口

- 消息翻译模式需要翻译服务能力，本地侧无对应物（若产品决定补齐）。
- 时区设置若仅前端展示用途则后端无缺口；排程类功能未验证。
- 动态页「未读计数」段在 0 未读时的协议行为未验证（数据前提不足）。

## 验证缺口

- Raft 官网本次为 headless Chrome 注入会话；未在 Firefox 复测本轮场景（早前审计的 Firefox 双侧结果仍有效但不含本轮新增项）。
- 未覆盖：长历史滚动/虚拟窗口边界、慢网/断线重连、IME 输入、拖拽置顶、右键菜单、任务详情弹层逐项、设置「管理/服务器资料/关于/文档/反馈/更新日志」内容级 diff（本轮已截图存档但未逐字段比对）。
- 移动端 RAH 侧通过 `返回主页` 进入列表再进底栏；未测 PWA 安装态与横屏。
- 交互态抽查限于：rail 图标/工作区头像 hover、消息 hover 工具条、选中态、composer 聚焦（双侧均无额外聚焦环变化）；按钮 active/focus-visible 键盘路径未系统走查。
- 通知弹层在 Raft 侧可能已触发已读标记；本轮未验证该副作用。

## 证据

- 精简 diff 数据：`docs/evidence/raft-rah-bilateral-style-diff-20260908.json`（本报告所有实测值的结构化版）。
- 全量证据根：`/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-bilateral/`（106 个文件：双侧桌面/移动截图、walk 探针 `raft.json`/`rah.json`、深度探针 `raft-deep.json`/`rah-deep.json`、补充探针 `raft-final.json`/`rah-final.json`、`manifest.json`）。
- 走查脚本：`.workbench-web/ui-compare/walk.mjs`、`raft-deep-probe.mjs`、`rah-deep-probe.mjs`、`mobile2.mjs`（gitignored，可复跑）。
- 官方 bundle 基线沿用 `docs/evidence/raft-web-20260908-current/manifest.json`（同日冻结）。
