# Raft Task 工作流对齐与正式浏览器审计

日期：2026-09-03

## 结论

本批把 RAH OS 的 Task 页面和公开业务流重新收敛到 Raft，而不是在看板上继续扩展一套 RAH OS
专用流程。全局 Tasks 与 Room 内 Task Tab 现在复用同一个看板、同一张卡片、同一个五状态菜单和同一条
typed 写入链。`claimed`、`waiting_input`、`blocked`、`submitted`、`cancelled` 等信息仍然存在，但只作为
后端执行、注意事项或取消证据；它们不再成为第六列、额外状态按钮或禁用 Raft 菜单的理由。

在本批覆盖范围内，没有已知的阻断级 Task 看板差异。仍需保留的证据边界列在报告末尾，不能据此扩大为
Raft 全站或所有权限组合的像素级一致。

## Raft 来源事实

当前在线来源为 `https://app.raft.build/assets/index-Biin3FEA.js`，SHA-256：
`e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9`。同时使用已登录的
`https://app.raft.build/s/hakasemac/tasks` 检查 live DOM、computed style、可访问树和实际点击结果。

源码与页面共同确认：

- `Ait` 是白底 Task 视觉卡片，`Zit` 是独立的 dnd-kit 拖拽外壳；拖拽 transform 不写到视觉卡片。
- 卡片为 2px 黑边、2px 右下硬阴影和 `10px 12px` 内边距；hover 在 100ms 内上移 1px并变为
  4px 硬阴影，active 向右下压 1px并改成 1px 阴影。
- live DOM 不是旧 RAH `.kcard` 的纵向 flex：视觉卡为 `display:block`、`gap:normal`、16/24px；
  `w-full text-left` 点击层为 `inline-block`，内部依次是 `flex items-start gap-2` 与
  `min-w-0 flex-1`。编号头高 16.5px、下距 6px，单行标题高 20px，底部状态区上距 8px、高 26px。
- 把生产 `Ait` HTML 与生产 CSS 放入 standards mode，并与正式 RAH OS 在同一 Chrome、1440×1000
  逐项计算：看板和列表单行无描述卡均为 105.25px；DPR=1/2 时分别取整为 105/211 个物理像素。
  看板标题每增加一行，卡片增加 20px。高度由上述盒模型与换行产生，不是固定的 `min-height`。
- 列表外层是 `space-y-6`，列表分组是 `space-y-2.5`：分组之间 24px、分组标题到第一张卡
  10px；看板列头则是 12px。二者不能共用同一个 margin。
- 卡片到看板滚动层之间的祖先全部是 `overflow:visible`；只有更外层 Tasks 内容区负责滚动。4px hover
  阴影因此能越过列内卡片容器显示。
- 状态按钮是 2px 黑边、`2px 8px` 内边距、12/16px 粗体；右侧为 10×10、40% opacity 的 Pencil，
  不是展开箭头。
- 冻结 bundle 的视图切换调用是 `ZUe(columns-3, size:12)` 与
  `R3e(layout-list, size:12)`，不是旧静态参考页里的 `kanban/list` 占位符。
  调用参数不是最终几何：`q5/II` 的 `[&_svg:not([class*='size-'])]:size-3.5` 覆盖为 **14×14px**。
  先前按调用点推断为 12px 的记录由此更正。空分组使用
  `border-2 border-dashed border-black/20 px-3 py-5 text-sm text-black/40`，没有居中类。
- `Vst` 的 `showChannelName` 只在全局 Tasks 为真；Room/Channel Tasks 的看板和列表都只显示
  `#任务号`，全局 Tasks 才显示 `#Room + #任务号`。
- 五个公开状态及顺序为 `todo / in_progress / in_review / done / closed`，即
  `待办 / 进行中 / 待确认 / 完成 / 已关闭`。
- `Itt/Att` 的普通成员迁移图是：
  - `todo -> in_progress | closed`
  - `in_progress -> in_review | done | closed`
  - `in_review -> done | in_progress | closed`
  - `done -> todo | in_progress | in_review | closed`
  - `closed -> todo | in_progress`
- 当前状态本身也显示在菜单中。重复选择只是关闭/维持当前项，不产生第二种业务动作，因此 Raft 的
  “待办”和“进行中”可以在菜单里再次看到和点击。
- 拥有 `deleteAnyTask` 能力的 owner/admin 获得顺序固定的全部五项；这不是从 Task 的认领、提交或审阅
  证据推断出来的权限。

## RAH OS 落地

### 前端

- `GlobalTaskBoard` 成为全局 Tasks 与 Room Task Tab 的唯一看板 owner。
- 卡片拆成拖拽外壳和视觉内层；Mouse、Touch、Keyboard Sensor 共用同一状态迁移函数。
- 视觉内层直接消费共享 `.rah-interaction-brutal` 状态协议；Task 专题 CSS 不再持有第二份
  `:hover` / `:active` 位移。这样 Raft 的上浮/按压不是某一页面碰巧相似的局部样式。
- 卡片专题层显式清除了生成样式遗留的 `display:flex/gap:8px/14px normal`，并复刻官方两层内容
  wrapper、16.5px 编号行盒和 `inline-block` 点击层；这修复了看板/列表多出的高度，而不是增加固定高度。
- 列内 `.kcol-body` 改为 `overflow:visible`。此前只检查卡片自身 computed shadow 会出现假阳性：4px
  阴影虽然已计算，但仍被父层裁切，所以肉眼看不出 hover。本批门禁同时检查真实指针结果和祖先 overflow。
- 后续复核发现，`.kcol-head[aria-expanded=true]` 的 12px 看板间距曾被列表继承。列表现以来源
  `space-y-2.5` 覆盖为 10px；卡片本体仍是 board/list 共用的内容派生高度，没有新增固定高度。
- 静止、hover、active 阴影与 transform 已从卡片和 Agent 操作区的私有规则上移到
  `.rah-interaction-brutal`；`.rah-interaction-shadow-host` 独立拥有非滚动父层的防裁剪合同。
- 状态入口改成 Raft 的 Pencil；移除主看板上 RAH OS 专用的“确认完成 / 关闭任务 / 重开为待办 /
  安全改派”第二套按钮流和关闭原因弹窗。
- 用户截图复核发现状态色曾由无边框 `.task-filter` wrapper 持有，而真正按钮再以
  `background:inherit` 继承；按钮的 2px 顶部 margin 因而暴露父层色条。Raft `_it` 的
  `badgeClassName` 实际直接落在 bordered button。本地现增加 `triggerClassName` 直达按钮，五种 tone
  全部迁入 trigger，wrapper 保持透明；同类静态审查确认其他 `DiscoveryFilter` wrapper 没有颜色类，
  Group/Activity chip 的颜色则直接落在自身有界元素，不存在同一泄漏结构。
- 两处 Tasks 工具栏已统一改用从冻结生产 bundle 提取的 `columns-3/layout-list` SVG，图标盒为
  14×14px；Room 看板通过同一 `GlobalTaskBoard` 的 scope 参数隐藏冗余 Room 名称，全局看板保持名称。
  空分组专题规则显式覆盖通用空态的自动居中，采用 20px 12px padding 与起始对齐。
- Room Tasks 工具栏复刻来源 `flex-wrap`：整件控件换行、工具栏随内容增高，避免 390px 下“新建任务”
  文字竖排并与视图切换重叠。新建入口按来源 `px-2 py-1 text-xs` 渲染为高 28px、12px 图标。
- 顶部频道详情/设置与搜索统一消费 `.rah-panel-header-action`：28×28px、14px 图标，移除旧设置入口的
  自动宽度和额外水平 padding。移动 Room 保留设置入口，隐藏搜索入口。
- owner/admin 显示全部五态；普通成员只显示 Raft 转移图允许的当前项和后继项。
- Done 与 Closed 仍按 Raft 默认折叠；真实浏览器门禁在需要操作隐藏卡片时先展开对应列，产品默认行为
  没有为了测试而改变。
- 非视觉增强只保留两项：独立的 focus-visible 键盘拖拽 handle，以及菜单的 radio 可访问语义。二者不改变
  Raft 的显示、鼠标操作或业务流。

### 协议与后端

- schema 44 增加独立、受约束的 `tasks.workflow_status`，旧数据按确定映射回填；原执行状态没有被破坏性
  改写。
- 协议包唯一拥有五状态枚举、旧状态兼容投影和 Raft `Att/Itt` 迁移图。
- Web 只调用 typed `task.workflow.update`；Kernel 重新校验 Room 成员、owner/admin 能力、最新 Room
  sequence、允许迁移和幂等键，然后发布 `task.workflow_updated` canonical 事件。
- 状态整理不会创建 Agent Activation。此前“切换看板状态会唤醒 Agent”的偏差已经删除并由 Kernel
  回归测试冻结。
- `done/closed` 在成员移除、Room 生命周期和 Workspace Agent 管理的“仍有活跃协作任务”判断中属于
  terminal；这只让 Raft 公开状态产生一致的业务效果，不会抹掉认领、运行、提交或审阅历史。
- 强制改派、取消栅栏、InputRequest 与 Review 继续由原后台 owner 保存，但没有重新暴露成与 Raft 不同的
  主看板流程。后续若要展示，必须先取得 Raft 对应入口证据。

## 双边浏览器证据

Raft 官方 Tasks 在已登录 Firefox 中执行页面/鼠标复核；冻结的生产 `Ait` HTML 与 CSS 再和正式
RAH OS `http://127.0.0.1:4173/?surface=tasks` 放进同一 Chrome 引擎做数值计算：

| 项目              | Raft 官方                             | RAH OS 正式页            | 裁决 |
| ----------------- | ------------------------------------- | ------------------------ | ---- |
| 列顺序            | 待办、进行中、待确认、完成、已关闭    | 相同                     | 一致 |
| 完成/关闭默认状态 | 折叠                                  | 折叠                     | 一致 |
| 列宽与卡片宽度    | 320px 列；292px 卡片                  | 320px 列；292px 卡片     | 一致 |
| 卡片边框/内边距   | 2px；10px 12px                        | 2px；10px 12px           | 一致 |
| 看板单行卡片高度  | 105.25px                              | 105.25px                 | 一致 |
| 列表单行卡片高度  | 105.25px                              | 105.25px                 | 一致 |
| 列内 overflow     | `visible`                             | `visible`                | 一致 |
| 卡片 hover        | `translateY(-1px)`；4px 硬阴影；100ms | 实测相同                 | 一致 |
| 列表标题到卡片    | 10px                                  | 10px                     | 一致 |
| 列表分组间距      | 24px                                  | 24px                     | 一致 |
| 状态按钮          | 24px 高；2px 8px；12/16px 粗体        | 实测相同                 | 一致 |
| 状态图标          | Pencil 10×10，opacity 0.4             | 实测相同                 | 一致 |
| 视图切换图标      | columns-3 / layout-list，最终14×14px  | 实测相同，见补充验收     | 一致 |
| Room 卡片编号头   | 仅 `#任务号`                          | 实测相同                 | 一致 |
| 全局卡片编号头    | `#Room + #任务号`                     | 实测相同                 | 一致 |
| 空分组文案        | 20px 12px padding，左对齐             | 实测相同                 | 一致 |
| 待确认底色        | `rgb(187, 175, 230)`                  | `rgb(187, 175, 230)`     | 一致 |
| owner 菜单        | 五项，当前待确认为选中项              | 五项，当前待确认为选中项 | 一致 |

105.25px 是当前 Chrome、当前字体、单行且无描述样本在 standards mode 的来源/RAH 同引擎值；它不是
所有数据内容的固定高度。用户截图中可见的细微纵向差异需要拆成卡片 border box、2/4px 阴影 footprint
和列头/分组 gap 三层判断，不能仅凭红色辅助线把外部 2px 间距算进卡片高度。看板标题每多一行会增加
20px；列表变宽后同一标题可因少一次换行而减少 20px。

正式 RAH OS 实测样本的卡片在看板为 292×105.25px，在列表为全宽×105.25px；状态按钮为
70×24px，Pencil 为 10×10px。门禁通过 CDP
`Input.dispatchMouseEvent` 把真实指针先移出、再移入卡片：静止态为 2px 黑边、2px 硬阴影，hover
后边框仍为 2px，computed transform 为 `matrix(1, 0, 0, 1, 0, -1)`，硬阴影为 4px，过渡为
100ms，且列内 overflow 保持 visible。Raft 官方同一状态按钮也为 70×24px，Pencil 为 10×10px；
父卡片静止态为 292×105.25px、2px 黑边、2px 硬阴影，真实指针后 y 减少 1px、阴影变为 4px。

### 精准验收裁决

1. **来源门禁**：冻结生产 release identity、JS/CSS URL 与 SHA-256；强上浮字面签名共七处，其中
   五处 active 1px、两处 active 2px。详见
   `docs/evidence/raft-brutal-lift-inventory-20260903.json`。
2. **结构门禁**：Task 的 DnD 外壳不持有视觉 transform；视觉卡消费共享 brutal 类；列表和看板
   复用同一 TaskCard DOM。
3. **几何门禁**：同一条单行无描述 Task 的 board/list border-box 高度相等，DPR 取整后的物理像素
   高度也相等；列表列头 gap=10px、组 gap=24px、卡片 gap=10px。
4. **指针门禁**：通过 CDP 真实移动鼠标，静止 2px 阴影，hover 4px 阴影并上移 1px；border 始终
   2px，transition=100ms。不能通过脚本加 class 冒充 hover。
5. **裁剪门禁**：列/虚拟行/DnD 外壳均不可裁切阴影；滚动仅归 Tasks 外层。祖先 overflow 扫描为空。
6. **像素门禁**：截图裁切在卡片四周保留至少 6px，不要求不同数据的整页零差，而是断言右/下硬阴影
   在静止态外延 2px、hover 外延 4px，且上/左边框没有被错误加粗。
7. **响应式门禁**：桌面同 viewport/DPR/zoom 做 Raft 双边；390×844 验证无横向裁切、触屏不依赖
   hover 才能操作，并保留键盘 focus 与 drag 语义。

## 自动验证与正式发布

- `npm run check`：通过；851 个包测试（849 pass、2 个真实 Provider opt-in skip）、251 个 Web 单测和
  34 个 parity regression 均为 0 failure。
- `node --test apps/web/test/task-workflow-parity-contract.test.ts`：7/7 通过，冻结官方 DOM wrapper、行盒、
  overflow owner、共享 hover owner、Pencil、五态写入、Room/全局编号头 scope，以及
  `columns-3/layout-list` 的 SVG、12px 调用参数和共享 CSS 的最终 14px 覆盖。
- `npm run test:web:browser` 已加入真实鼠标、看板/列表 105.25px、父层 overflow 和 4px 阴影断言。
  2026-09-04 首次重跑已通过原 Thread 选择 Escape 段，随后在 390×844 的转发 dialog Escape 段暴露
  同一键盘事件穿透到选择层的问题；底层选择 owner 增加 `defaultPrevented + modalOpen` 双重闸门后，
  完整长旅程从桌面到 390×844 通过。新增门禁还在 Room Tasks 实测两枚 SVG、左对齐
  空分组、仅任务号的编号头，并在全局 Tasks 等待数据水合后确认 Room 名称仍存在；Task 专项对正式
  4173 的同组鼠标断言也继续通过。
- `npm run build:web:workbench`：通过，3038 modules transformed。
- `npm audit --omit=dev`：0 vulnerabilities。
- 正式 4173 在确认 queued/leased/quarantined Activation、active Run/Runtime、未完成改派和 Computer
  operation 均为零后重启；健康状态 `online`，数据库 `user_version=45`，现有 Task 的
  `workflow_status=in_review` 保持不变。

### 2026-09-04 标题栏及窄屏工具栏补充验收

源码测试先复现固定高度、未换行的工具栏与图标调用参数误读，再修正实现。此次以冻结 bundle 的
`T8 → rn(sm, icon)`、`q5/II` 与 Room Tasks toolbar 源码为依据；这不是新一轮官方同前置数据的全页像素差分。

- `npm run check`：864 个包测试（862 pass、2 个付费 Provider opt-in skip）、264 个 Web 单测、
  34 个 parity regression，全为 0 failure。Core 清单门禁随全套测试通过。
- 专题源合同与 UI token 测试共 19/19 通过；来源规则和本地实现同时受断言约束。
- `npm run test:web:browser`：完整隔离 Chrome 长旅程通过，包含 Thread/转发 Escape、断点扫描、
  标题栏 28/14px 与 Room Tasks 在 390×844 下的列表/看板真实点击；新增断言拒绝控件重叠、
  越出工具栏、文字折行和 document 横溢。
- `npm run test:web:firefox`：生产构建、1440×1000 与 390×844 持久化工作台通过；构建为
  3041 modules。`npm run format:check`、`git diff --check` 通过，生产依赖 audit 为 0 vulnerabilities。
- 正式更新前确认 30 Activation 均 completed、30 RunAttempt 均 exited、30 Runtime 均 terminated；
  取消/改派/Computer 操作、Workspace lease、pending InputRequest 均为零。数据库、配置、附件及
  Agent memory 备份在 `/Users/sun/.rah/backups/pre-task-controls-20260904-nIO8QP`；备份数据库
  `quick_check` 与 `foreign_key_check` 通过。
- 对已确认的 PID 82767 发送 TERM，确认进程退出、端口释放后启动 PID 87142；正式 4173 使用冻结构建
  `63f5c024d02c3603b493c54b85614ab61ebb085746cf2fa9a6f9d5e82e6fe351`，入口为
  `/assets/index-DCq2LC--.js`，健康状态 online。
- 新建 Chrome 和 Firefox 正式页面，在 1440×900 与 390×844 实测：设置按钮 28×28、内部图标14×14；
  两枚视图图标14×14；Room 编号头仅 `#1`；新建按钮高28px、12px字体且不换行；工具栏控件互不重叠且
  完整落在外框内，页面宽390px。真实鼠标 hover 后卡片上移1px，设置可打开并用 Escape 关闭，pageerror=0。
- 正式截图位于 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-task-controls-formal-bP2yGE`。
  已人工查看 Chrome 桌面 hover、移动列表与 Firefox 移动看板，确认阴影可见、控件完整换行。
  首次临时截图脚本误用了不存在的 `.kcard-meta` 而超时；更正为真实 `.kcard-no` 后两浏览器全部通过，
  未为适配脚本修改产品 DOM 或放宽断言。
- 重启后仍为 schema46、6 Room、40 Message、4 Agent、1 Task；Agent memory 与备份逐文件相同。
  用户当前 IAB 标签已刷新并实测相同 build ID、28/14px 几何，没有残留 Failed to fetch。
  正式环境未发送测试消息，未启动付费 Provider，未提交或推送 Git。

本次证据仍分为源码合同、隔离浏览器、正式页面三层；修复指定几何与交互不代表全站像素级完全一致。

## 保留边界

1. 官方登录身份是 owner，因此非 owner 的菜单只由 Raft bundle 转移图、协议测试和隔离浏览器角色门禁
   证明，未声称完成官方非 owner 账号的双账号实测。
2. Raft Server 的数据库和 mutation 内部没有公开源码；RAH OS 后端是在不改变 Raft 可见合同的前提下，
   用本地 Room ACL、sequence 与 idempotency owner 实现同一结果，不能表述为服务端逐行移植。
3. 本报告只关闭 Task 看板、状态菜单与状态写入主链。Task 详情中未来出现的新 Raft 控件、未取得的极端
   权限空态以及跨 Computer 执行不是本批完成项。
4. RAH OS 的执行/注意事项分层是已有业务事实的保存方式，不是新增公开工作流。后续改进只能作为次级
   证据或取得 Raft 入口后的补强，不能先于 Raft 基线改变主页面。
