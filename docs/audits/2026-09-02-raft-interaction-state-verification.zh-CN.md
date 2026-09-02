# 2026-09-02 Raft / RAH 前端操作状态审计

## 结论

本轮已把“浏览器默认按钮 + 页面散装 hover”收敛为产品级状态协议，并修复首批
高频差异。当前可以说：**七个核心路由的可见按钮不再泄漏浏览器原生灰色/outset
样式，主 rail、设置/成员/Computer 行、侧栏小按钮、任务 segmented、brutal 按钮、
表单 focus 和消息工具条已经按 Raft 当前发布入口归类。**

当前仍不能说“所有 Raft 前端交互已经完美适配”：13 个引用 JS 未归档，权限/空态
会改变可见控件。1,836 是未经去重的原始回调位置，包含共享组件重复实例、供应商库、
权限分支和内容渲染器，不能把它称为 1,836 个功能或剩余缺口。业务点击完成度仍以
74 项行为指南和各专题合同为准。

## 证据

- Raft：`https://app.raft.build/` 登录态，入口 `index-BoAC7nSE.js`。
- 冻结源码：23 文件、1,836 事件候选；消息工具条 class 位于入口 byte
  `2958627`，列表行 hover/active class 位于 byte `2812956`，`btn-flat-sm`
  位于 `1938321` / `2808033`。
- 双边浏览器：Chromium，1280×720，DPR 2；相同窗口逐路由读取 computed style，
  不用截图颜色猜测。
- 本地构建：`http://127.0.0.1:4173` 正式本机 daemon。

## 路由扫描

扫描器读取可见 `button/a/input/textarea/select/role=button|tab`。Raft 当前数据状态下
可见操作位置为 Chat 21、Search 16、Activity 16、Tasks 17、Members 42、Computers
12、Settings account 28；各页面均为 0 个 native gray/outset 泄漏。RAH 对应状态为
Chat 112、Search 19、Activity 20、Tasks 15、Members 37、Computers 12、Settings 22，
同样均为 0。数量不可直接比较：两边消息、Agent、Room 和空态数据不同。

## 双边 computed-style 结果

| 样本                      | Raft                                           | 修复后的 RAH                      | 结果 |
| ------------------------- | ---------------------------------------------- | --------------------------------- | ---- |
| 设置未选中行              | 222×32，透明边，pointer，150ms cubic           | 同协议                            | 通过 |
| 设置行 hover              | 白底、2px 黑边、2px 黑阴影                     | 同协议                            | 通过 |
| 账户保存 unchanged        | 76×32、12px、opacity .5、not-allowed           | dirty 门禁 + 同几何/状态          | 通过 |
| 账户 text input           | 40px、14px；focus 4px 右下硬阴影，无 outline   | 同；资料卡不再私自限宽 760px      | 通过 |
| composer textarea         | 内部 0 border / no outline；外盒 focus 4px     | 同；不再出现黑色内框              | 通过 |
| 私信行                    | 222×32；150ms cubic                            | 几何相同，ease 改 cubic           | 通过 |
| 分组标题                  | cursor default；hover black/70；150ms cubic    | pointer 回调为 default；同 timing | 通过 |
| 排序/创建                 | 24×24 flat；100ms cubic；hover black/5         | 接入 flat 协议，创建调整 24×24    | 通过 |
| 消息工具条                | row 边框即时；toolbar opacity 0→1，150ms cubic | 同，ease 改 cubic                 | 通过 |
| 快捷回应浮层              | 224×40；18px sprite；pink/20；移出 120ms 关闭  | 同；无 hover 加粗/硬阴影          | 通过 |
| 收藏反馈                  | yellow/30 hover；orange glyph；正文“已保存”    | 同；徽标可直接移除                | 通过 |
| rail                      | 40×40；150ms cubic                             | ease 改 cubic                     | 通过 |
| Computer / Workspace 标识 | 40×40；100ms cubic；hover 4px 阴影且不位移     | 同协议                            | 通过 |
| selected 行               | 粉底黑边阴影；无 transition                    | 同                                | 通过 |
| Activity 完成动作         | 默认 opacity 0；card hover 后 100ms cubic 显示 | 同；触屏常显                      | 通过 |
| Chat / Agent tabs         | `cursor:default`；选中黄底；立即切换           | 同，无私有 easing                 | 通过 |
| Tasks segmented           | 未选白底、选中黄底；立即切换                   | 同                                | 通过 |
| raw button preflight      | 无 UA 灰底/outset                              | 七路由扫描为 0                    | 通过 |

## 首批代码变更

- 新增共享 `interaction-state.css`：button preflight、row、flat、brutal、segment、
  legacy rail/channel/tab timing。
- Settings、Agent、Computer、Search、Tasks、侧栏排序/创建等入口显式选择状态族。
- 账户保存增加 dirty 门禁；设置输入和保存按钮采用 Raft 40/32px 几何。
- Chat 分组标题保留 Raft 的 `cursor:default` 例外；消息工具条使用 150ms cubic。
- 没有改 Room/Task/Agent 后端 owner，也没有复制 Raft 中央服务器或账号套餐逻辑。

## 正式重启后的真实操作验收

- 最终正式进程 PID `63480`，`/_rah/health` 返回 `online`；页面加载本批构建
  `index-BM-A34eE.css` / `index-Bv9GSUo2.js`。重启后的独立浏览器只读复核确认
  `readyState=complete`、1280px 视口无横向溢出、无可见 `role=alert`，控制台无
  warning/error。
- Chat 频道排序：鼠标点击后 `aria-expanded=true`，弹层内容为
  “手动 / 最近 / A-Z”；Esc 关闭，`aria-expanded=false`，焦点回到原按钮。
- 消息回应：先把鼠标移入消息行，行边框立即出现，工具条由 opacity 0 经 150ms
  渐显；点击“添加回应”出现七个回应选项；Esc 关闭并把焦点还给“添加回应”。
- 设置：点击“外观”后 URL 切换到 `settingsSection=appearance`，行变粉底、黑边和
  2px 硬阴影，`aria-current=page`。
- Tasks：点击“列表”后列表黄底、看板恢复白底，两者 `transition:none`。
- Agent：点击“动态”后 URL 切为 `agentTab=activity`，动态黄底、资料恢复白底，
  页签无错误过渡动画。
- 390×844 下 Chat、Search、Settings 的 `scrollWidth` 都等于 390，无横向溢出；
  同一个本地组件和状态协议生效。

## 自动门禁

- `npm run typecheck`、`npm test`、`npm run test:web:unit`、
  `npm run test:parity:regression`：通过；包级 752 项（750 通过、2 项显式跳过）、
  Web 156 项、真实回调回归 34 项均无失败。schema 32 新增 held-draft 生命周期后，
  版本断言、协议入口规模和发送后幂等重试也已进入这些门禁。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench`：通过。
- `npm run test:web:firefox`：通过；Firefox 150.0.2，桌面 1440×1000 与移动
  390×844。
- `npm run test:web:workbench`：通过；真实 Chrome、390×844、生产构建、浏览器与
  daemon 重启连续性、Fake Provider 恢复均通过。
- `npm run test:web:message-timeline`：通过；10,050 条逻辑消息只保留 27 个 DOM 行，
  向上分页锚点位移 0px，Markdown 连续刷新 20 次无失败。夹具已补齐新增的
  `roomEvents` / `roomMembers` 合同，避免把夹具异常误判为产品超时。
- `npm run test:web:browser`：通过；真实 Chromium 完成 Room/DM、Agent、Task、
  Thread、MCP、设置、上传和移动端 390×844 主链。旧门禁原先错误要求同一并发
  Room 消息由 Alice 和 Kimi 都回复；canonical freshness 合同实际要求只发布一个
  仍然新鲜的回复。门禁已改为验证恰好一个可见 winner；其他 Activation 的终态由
  Kernel/daemon 集成测试覆盖，本浏览器断言不重复扩大成“全部终态已由 DOM 证明”。
- Agent runtime/model/effort 三个 picker 均逐个实测：打开菜单、Esc 关闭、焦点返回
  原 trigger；隔离夹具现在由真实v3 probe report发布两个model binding，每个binding
  发布`low/high` effort，而不是在浏览器伪造option。runtime、model和effort均完成新值
  选择；runtime单独保存/重开/恢复，model+effort联合保存、关闭后重开持久化、恢复默认
  并再次重开确认。外层运行时 Dialog 再次 Esc 后焦点返回“编辑运行时配置”。门禁不调用
  付费Provider，也不包含Ultra。
- 正式持久数据的只读复核进一步确认：Codex目录来自daemon的真实probe结果，当前列出
  `GPT-5.6-Sol`、`GPT-5.6-Terra`、`GPT-5.6-Luna`、`GPT-5.5`、`GPT-5.4`和
  `GPT-5.4-Mini`；在未保存状态选择`GPT-5.4`后，effort目录列出`Low / Medium /
High / Extra high`。点击“取消”后Dialog关闭，资料页仍显示Runtime默认，没有写入正式
  Agent配置。切换Kimi私信到Codex私信时，旧Agent资料侧栏同步关闭。
- 独立审计发现遗留 token 的 `transform` 与新协议 individual `translate` 会让 press
  实际叠加成 2px，disabled 也会继承旧 hover。现已统一为一个 `transform` owner，
  所有 hover/active 显式排除 disabled；真实 Chrome 门禁逐帧验证 enabled 为上移
  1px/按下右下 1px，且 disabled brutal/flat/segment 的 computed style 完全不变。
- Room 侧栏完成真实 pointer drag：源行 opacity `.35`、overlay 为产品粉色、落点为
  2px 黑线；顺序实际写入后再拖回原位。Firefox 同时继续验证 Room 与 Agent
  splitter 的最小值、最大值与恢复值。
- Settings 390×844 已替换横向 Tab 为 Raft 源码的“设置目录 → 当前页 → 返回设置”
  链路；Firefox 点击往返通过，`scrollWidth=390`。
- 独立审计代理在主代理修复后连续两次完整运行 `npm run test:web:browser`，两次均
  通过；随后主代理在最终代码上再次运行一次也通过。独立复核覆盖正反 Room 拖拽、
  Chrome computed style、disabled 不变、picker Esc/focus、runtime 保存/恢复和
  desktop/390 主链，没有以单次偶然成功代替裁决。
- Firefox 消息社交指针门禁新增真实写操作再回滚：回复/收藏 hover 均为
  `rgba(255, 212, 64, 0.3)`；回应浮层 224×40、✅ sprite 18×18、`用 ✅ 回应`
  tooltip；快捷回应停稳后的 hover 为 Raft `#FE7DA8` 的 20% 混色，trigger 到
  portal 的 120ms 桥接保持打开，scroll、Esc、外点与指针移出关闭均为自动断言。
  收藏后 toolbar glyph 为 `rgb(248, 161, 111)` 且 `fill=currentColor`，正文
  “已保存”出现；点击徽标后私人收藏被移除。

## 尚未完成的操作审计

1. 已实测七项快捷回应 picker、Chat 排序、Search sender dropdown、Agent
   runtime/model/effort、Room pointer drag，以及新增/删除/完成/改派等代表性 Dialog；
   相同共享组件的每个业务实例不重复点击计数。Raft 的中央页面可以在线而 Computer
   离线；RAH 的 Web 由同一本机 daemon 提供，daemon 离线时页面本身不可用，因此这个
   中央式离线详情不是可构造的同前置双边目标。RAH 应改验 daemon health、重启恢复、
   页面重连和本地 runtime/Agent 状态，不能把结构差异登记成 UI 缺口。
2. 侧栏排序已经验证 pointer drag 与键盘置顶；Room/Agent 两类 splitter 已在 Firefox
   验证拖动边界。尚未逐实例录制 Raft 与 RAH 的视频像素差分。若实施，应固定 viewport、
   DPR、zoom 与 fixture，按同一指针脚本在 idle/hover 0/50/100/150ms/press/open/leave/close
   检查点逐帧截图；先对齐并裁剪同一组件，遮罩时间戳、光标和不同业务数据，再输出绝对
   差分、SSIM 与叠加图。它适合验几何、颜色和动画时序，不替代点击结果、ACL 或后端语义断言。
3. 13 个缺失引用 JS、权限/数据分支和 1,836 原始候选的未归一语义不能被本轮控件族覆盖替代。
   所以结论是“当前核心可见控件族及主链通过”，而不是“Raft 全站所有条件功能 1:1”。

## 13个未归档引用的源码优先裁决

2026-09-02在同一登录态Raft页面做只读动态触发：初始/聊天页加载
`vendor-react`、`vendor-markdown`、`vendor-socketio`；设置资料加载`upload`；点击设置
“反馈”后才加载`bug`与`AboutFeedbackDialog`，并请求
`/api/product-feedback/tickets?limit=20`。消息“添加回应”展开七个固定快捷回应时没有加载
`emoji-picker-react`。这支持以下裁决：

| 引用                                          | 源码/触发事实                                  | 产品裁决                              |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `AboutFeedbackDialog`、`bug`                  | 设置反馈动态分块；中央feedback API             | 当前范围外，不移植中央服务            |
| `index-DQuoke3Q`                              | `SettingsPanel`中为移动下载URL编码二维码       | 当前应用下载页范围外                  |
| `upload`                                      | Agent/Human/Workspace/Settings资料共用上传图标 | 复用现有资料上传，不当作独立能力      |
| 三个`vendor-*`                                | 全局React/Markdown/Socket依赖                  | 供应商实现，不形成业务缺口            |
| `message-square-text`                         | Threads/Workspace demo图标导入                 | 图标资产，不形成后端缺口              |
| `transform`                                   | `MemberGraphSection`的SVG坐标、缩放/拖动实现   | 关系图交互依赖，按关系图专题验收      |
| `mermaid.core`、`shikiHighlighter`、`runtime` | 入口的Markdown内容动态依赖链                   | 按消息图表/代码内容验收，不按按钮计数 |
| `emoji-picker-react`                          | 固定七回应未触发                               | 条件式完整picker待追踪，不能外推通过  |

这一步完成的是语义分类，不是把13个文件都复制进仓库。Raft发布bundle只作分析证据；RAH
继续用既有owner实现本地行为，并对每个真正产品缺口做独立测试。

最终正式重启前备份：
`/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-raft-runtime-20260902-vlZ6oC`；
备份包含完整`state`副本以及`room.snapshot.db`、`runtime-registry.snapshot.db`两份一致性
快照，两份 SQLite 的 `PRAGMA quick_check` 均为 `ok`。重启前26个Activation均为
`completed`，26个run attempt均为`exited`，26个runtime process均为`terminated`，
没有中断正在工作的Agent。

## 消息社交状态最终收口与正式重启

- 本批先红测命中工具条误用粉色，再按冻结源码实现；书签内联填充修正前的完整
  `npm run check` 为 752 项包测试（750 通过、2 项 opt-in 跳过）、156 项 Web 单测、
  34 项回调回归，0 失败。最终代码的本批静态状态协议、Web TypeScript、定向 Prettier、
  `git diff --check`、`npm audit --omit=dev`、Firefox 与 Chrome 浏览器门禁均通过，依赖
  审查为 0 vulnerabilities。最终再次运行全仓 `npm run check` 时，被并行在途、非本批的
  `packages/application-service/src/computer-application-service.ts` exact-optional 类型错误
  阻断；全仓 Prettier 同样报告 9 个非本批在途文件。本批文件本身全部格式通过，未覆盖
  或代改这些文件。
- Firefox 150.0.2 在 1440×1000 的隔离持久 fixture 中真实点击并回滚收藏；Chrome
  全主链在 390×844 通过。两者均未调用付费 Provider。
- 最后一次生产修正前再次确认 26 个 Activation 全部 `completed`、26 个 RunAttempt 全部
  `exited`、26 个 RuntimeProcess 全部 `terminated`、26 个 Placement 全部
  `released`。完整 state 副本和两份 SQLite 在线快照位于
  `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-filled-bookmark-20260902-ECVpBl`，
  两份 `PRAGMA quick_check` 均为 `ok`。
- 精确停止旧进程后正式实例已重新启动；最终 PID `74278` 监听
  `http://127.0.0.1:4173/`，health 为 `online`，加载
  `/assets/index-DJ9LxFqa.js` 与 `/assets/index-B3bkXCGm.css`。重启后状态仍为上述
  26/26/26/26 全终态，Room DB quick check 为 `ok`。
- 重启后的正式实例另用真实 Chrome 做只读指针验收：页面自动恢复默认 Room；回应浮层
  224×40，软阴影为 `rgba(0, 0, 0, 0.08) 0 4px 12px`，✅ glyph 18×18，tooltip
  为“用 ✅ 回应”，移出 140ms 后 portal 已卸载。页面无可见 alert、console error 或
  page error。正式库没有因这项只读检查新增回应、收藏、消息或 Activation。

## Emoji 居中、收藏常驻色与共享摘要行复核

- 冻结 Raft 入口 `index-BoAC7nSE.js` 的快捷按钮 class 明确为 28×28、`rounded`
  （computed `4px`）、`flex items-center justify-center`、hover `brutal-pink/20`；登录态
  DOM 实测 sprite 为 18×18，按钮与 sprite 中心偏差为 0/0。收藏按钮激活分支为
  `text-brutal-orange` 且 `fill=currentColor`，并非灰色；消息后置摘要父容器为
  `mt-1.5 flex flex-wrap items-center gap-1.5`，收藏与回应是同级项。
- 本地先用失败合同锁定旧问题：收藏激活选择器被通用工具栏选择器压过，回应和收藏虽
  在外层同容器内，回应仍多包一层块级容器。修复后，快捷按钮 28×28、4px、padding 0、
  flex 双轴居中；激活书签离开鼠标后仍为 `rgb(248, 161, 111)` 实心态；收藏与回应作为
  同一个 `.rah-message-social-summary` 的直接子项，`display:flex`、`align-items:center`、
  `gap:6px`，分别点击均可取消。
- Firefox 150.0.2 隔离 fixture 在 1440×1000 真实执行 hover、点击、移出、同排坐标和
  两项回滚；Chrome 全主链及 390×844 门禁通过。`npm run check` 全量通过：包级
  760 项（758 通过、2 项 opt-in 跳过）、Web 159 项、回调回归 34 项，0 失败；
  `npm audit --omit=dev` 为 0 vulnerabilities。
- 正式重启前 26/26/26/26 分别为 completed/exited/terminated/released，备份位于
  `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-social-layout-20260902-Qfh0pp`，
  完整 state 副本与两份 SQLite 快照均 `quick_check=ok`。daemon 的 60 秒旧实例接管
  栅栏阻止了重叠启动；最终只有 PID `84830` 监听 4173，health 为 `online`，加载
  `/assets/index-3uS9Al_r.js` 与 `/assets/index-DEqy1Kke.css`。
- 重启后的正式 Room 再真实添加 ✅ 与收藏：快捷按钮实测 28×28、4px、18×18 sprite、
  中心偏差 0/0；工具栏书签移出后为 `rgb(248, 161, 111)`、`fill=currentColor`；摘要
  `flex/center/6px` 且两项 y 坐标相同。随后分别点击回应 chip 与“已保存”完成回滚。
  最终正式库回应/收藏均为 0，26/26/26/26 终态未改变，Room DB `quick_check=ok`，
  页面无可见 alert。

### 2026-09-02 多回应与消息后置组件精确收口

- 官方冻结源码确认消息回应是数组而非单选：新增 emoji 走 append，同 emoji 按当前 viewer
  成员身份 add/remove，正文 footer 对所有正计数回应逐项 `map`。官方页面临时加入 ✅ 后读取
  计算样式并立即回滚：chip 20px 高、38.3515625px 实际内容宽、4px 圆角、左右 6px
  padding、4px gap、15×15 sprite；计数 12px/700/12px，`Space Mono, ui-monospace,
monospace`，tabular nums；本人态 pink/20，过渡 150ms。父 footer 为 flex/center/wrap/
  6px gap，每项另有 inline-flex slot。
- 本地 Kernel 新增同一 Human 对同一消息同时保留 ❤️ 与 👍 的回归；移除 👍 后 ❤️ 仍在，
  证明不是 UI 假多选。Firefox 隔离产品门禁真实依次添加 ✅、❤️ 与私人收藏，等待两次网络
  结果后确认两个 chip 与收藏均处于同一摘要行，再逐项点击回滚。
- 本地计算样式门禁同时锁定：chip 20px、4px、0×6px、gap 4px、15px sprite、12px
  leading-none 与 mono tabular count；saved badge 20px、1px 黑边、0×6px、10px 图标与
  10px/700/10px 文字，`filter` 100ms，hover 稳定值 `brightness(.9)`。
- 语义审计：收藏只进入 `human_saved_messages` 私人索引，Agent 不可感知；回应追加
  `message.reaction_changed` 共享注解但不 deriveAttention，不会单独启动 Agent。后续由正常
  工作创建的 Activation 可以在其有界 Room range 中同步到此前回应。Raft 前端还声明了
  bound Agent credential 的 reaction add/remove 能力，但没有发布证据证明 Human 回应会自动
  wake Agent，因此没有擅自增加该策略。
